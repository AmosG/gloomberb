import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { ChoiceDialog } from "../components/ui/choice-dialog";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { useShortcut } from "../react/input";
import { useAppDispatch, useAppSelector } from "../state/app/context";
import { selectActiveLayoutIndex, selectSavedLayouts } from "../state/selectors-ui";
import { useDialog, useDialogState, type PromptContext } from "../ui/dialog";
import { useRendererHost, useUiHost } from "../ui";
import { apiClient, type TeamSummary } from "../api-client";
import { requestAuthDialog } from "../plugins/builtin/cloud/auth-dialog";
import { teamStore } from "../plugins/builtin/cloud/team/store";
import { usePlanAccess } from "../plugins/builtin/shared/plan-access";
import { getMarketplaceHost } from "../plugins/builtin/plugin-marketplace/store";
import { rememberLayoutRequirements } from "../components/layout/missing-pane";
import type { PluginRegistry } from "../plugins/registry";
import type { LayoutConfig } from "../types/config";
import { LayoutGalleryDesktop } from "./gallery-desktop";
import { LayoutGalleryTerminal } from "./gallery-terminal";
import { LayoutNameDialog } from "./name-dialog";
import {
  buildCommunityEntries,
  buildOwnedEntries,
  buildTeamEntries,
  filterGalleryEntries,
  missingPaneIds,
  type GalleryEntry,
} from "./model";
import { computeLayoutRequirements, LayoutRevisionConflictError, type CloudLayoutEntry } from "./cloud";
import { linkedLayoutUpdates, originFromEntry } from "./linked";
import { publicMarketplaceLayoutUrl } from "./api";
import {
  materializeMarketplaceLayout,
  publishableMarketplaceLayout,
} from "./payload";
import { useLayoutMarketplace, useTeamLayouts } from "./use-marketplace";

export interface LayoutGalleryController {
  query: string;
  setQuery: (query: string) => void;
  owned: GalleryEntry[];
  community: GalleryEntry[];
  /** One section per team the account is in, in team name order. */
  teamSections: Array<{ team: TeamSummary; entries: GalleryEntry[] }>;
  teamLayouts: ReturnType<typeof useTeamLayouts>;
  /** Owned entries first, then team, then community, in the order the destination renders them. */
  entries: GalleryEntry[];
  /** Publish the current tab to a team (new layout), or push a revision when it is linked. */
  publishToTeam: (entry: GalleryEntry) => void;
  pullTeamUpdates: (entry: GalleryEntry) => void;
  unlink: (entry: GalleryEntry) => void;
  teams: TeamSummary[];
  selectedId: string | null;
  select: (id: string | null) => void;
  detail: GalleryEntry | null;
  openDetail: (entry: GalleryEntry) => void;
  closeDetail: () => void;
  activate: (entry: GalleryEntry) => void;
  install: (entry: GalleryEntry) => void;
  discover: ReturnType<typeof useLayoutMarketplace>;
  signedIn: boolean;
  requestSignIn: () => void;
  publishCurrent: () => void;
  copyLink: (entry: GalleryEntry) => void;
  publishing: boolean;
  newLayout: () => void;
  renameLayout: (entry: GalleryEntry) => void;
  duplicateLayout: (entry: GalleryEntry) => void;
  deleteLayout: (entry: GalleryEntry) => void;
  canDelete: boolean;
  close: () => void;
  panes: PluginRegistry["panes"];
  missingPaneIds: (layout: LayoutConfig) => string[];
}

export function LayoutMarketplaceGallery({
  pluginRegistry,
  focused = true,
  width,
  height,
  onClose,
}: {
  pluginRegistry: PluginRegistry;
  focused?: boolean;
  width?: number;
  height?: number;
  onClose?: () => void;
}) {
  const dispatch = useAppDispatch();
  const dialog = useDialog();
  const renderer = useRendererHost();
  const dialogOpen = useDialogState((state) => state.isOpen);
  const layouts = useAppSelector(selectSavedLayouts);
  const activeIndex = useAppSelector(selectActiveLayoutIndex);
  const currentLayout = useAppSelector((state) => state.config.layout);
  const currentPaneState = useAppSelector((state) => state.paneState);
  const { signedIn } = usePlanAccess();
  const discover = useLayoutMarketplace(true, signedIn);
  const teamSnapshot = useSyncExternalStore(
    (onChange) => teamStore.subscribe(onChange),
    () => teamStore.getSnapshot(),
  );
  const teams = teamSnapshot.teams;
  const teamLayouts = useTeamLayouts(signedIn, teams);
  const remoteRevisions = useSyncExternalStore(
    (onChange) => linkedLayoutUpdates.subscribe(onChange),
    () => linkedLayoutUpdates.snapshot(),
  );
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const panes = pluginRegistry.panes;
  const owned = useMemo(
    () => filterGalleryEntries(buildOwnedEntries(layouts, activeIndex, { panes, teams, remoteRevisions }), query, panes),
    [activeIndex, layouts, panes, query, remoteRevisions, teams],
  );
  const community = useMemo(
    () => filterGalleryEntries(buildCommunityEntries(discover.state.items), query, panes),
    [discover.state.items, panes, query],
  );
  const teamEntries = useMemo(
    () => filterGalleryEntries(buildTeamEntries(teamLayouts.state.items, teams, layouts), query, panes),
    [layouts, panes, query, teamLayouts.state.items, teams],
  );
  const teamSections = useMemo(
    () => teams.map((team) => ({ team, entries: teamEntries.filter((entry) => entry.team?.id === team.id) })),
    [teamEntries, teams],
  );
  const entries = useMemo(() => [...owned, ...teamEntries, ...community], [community, owned, teamEntries]);
  const detail = useMemo(
    () => entries.find((entry) => entry.id === detailId) ?? null,
    [detailId, entries],
  );

  const close = useCallback(() => {
    if (onClose) onClose();
    else pluginRegistry.hidePane("layout-marketplace");
  }, [onClose, pluginRegistry]);

  const activate = useCallback((entry: GalleryEntry) => {
    if (entry.kind === "community" || (entry.kind === "team" && entry.index === null)) {
      setDetailId(entry.id);
      setSelectedId(entry.id);
      return;
    }
    close();
    if (entry.index !== null && entry.index !== activeIndex) {
      dispatch({ type: "SWITCH_LAYOUT", index: entry.index });
    }
  }, [activeIndex, close, dispatch]);


  const requestSignIn = useCallback(() => {
    if (!requestAuthDialog({ mode: "login" })) {
      pluginRegistry.notify({ body: "Open Account Management to log in.", type: "info" });
    }
  }, [pluginRegistry]);

  const promptName = useCallback(async (options: {
    title: string;
    label: string;
    confirmLabel: string;
    initialValue?: string;
  }) => {
    const name = await dialog.prompt<string | undefined>({
      closeOnClickOutside: true,
      content: (context: unknown) => (
        <LayoutNameDialog
          {...(context as PromptContext<string | undefined>)}
          title={options.title}
          label={options.label}
          confirmLabel={options.confirmLabel}
          initialValue={options.initialValue ?? ""}
        />
      ),
    }).catch(() => undefined);
    return typeof name === "string" ? name.trim() : "";
  }, [dialog]);

  const teamEntryFor = useCallback((entry: GalleryEntry): CloudLayoutEntry | null => (
    entry.marketplaceId
      ? teamLayouts.state.items.find((item) => item.id === entry.marketplaceId) ?? null
      : null
  ), [teamLayouts.state.items]);


  const install = useCallback((entry: GalleryEntry) => {
    // A team layout that is already open as a tab: go there instead of a copy.
    if (entry.kind === "team" && entry.index !== null) {
      activate(entry);
      return;
    }
    const cloud = entry.kind === "team" ? teamEntryFor(entry) : null;
    const origin = cloud ? originFromEntry(cloud) : null;
    if (cloud) rememberLayoutRequirements(cloud.id, cloud.requires);
    const installed = materializeMarketplaceLayout(entry);
    close();
    dispatch({
      type: "INSTALL_LAYOUT_COPY",
      name: entry.name,
      layout: installed.layout,
      paneState: installed.paneState,
      ...(origin ? { origin } : {}),
    });
    pluginRegistry.notify({
      body: origin ? `Opened "${entry.name}" from ${entry.team?.name ?? "the team"}` : `Layout "${entry.name}" added`,
      type: "success",
    });
  }, [activate, close, dispatch, pluginRegistry, teamEntryFor]);

  const requirementsFor = useCallback((layout: LayoutConfig) => {
    const installed = new Map((getMarketplaceHost()?.listInstalled() ?? []).map((plugin) => [plugin.id, plugin]));
    return computeLayoutRequirements(layout, {
      panePluginId: (paneId) => pluginRegistry.getPanePluginId(paneId),
      pluginInfo: (pluginId) => {
        const plugin = pluginRegistry.allPlugins.get(pluginId);
        const meta = installed.get(pluginId);
        if (!plugin) return null;
        const homepage = plugin.homepage ?? "";
        const github = /github\.com\/([^/]+\/[^/#?]+)/.exec(homepage);
        return {
          builtin: meta ? meta.source === "builtin" : true,
          version: plugin.version,
          ...(github?.[1] ? { repo: github[1].replace(/\.git$/, "") } : {}),
        };
      },
    });
  }, [pluginRegistry]);

  const chooseTeam = useCallback(async (): Promise<TeamSummary | null> => {
    if (teams.length === 0) {
      pluginRegistry.notify({ body: "Join or create a team first with TEAM.", type: "info" });
      return null;
    }
    if (teams.length === 1) return teams[0]!;
    const defaultId = teamStore.getDefaultTeamId();
    const id = await dialog.prompt<string>({
      closeOnClickOutside: true,
      content: (context: unknown) => (
        <ChoiceDialog
          {...(context as PromptContext<string>)}
          title="Publish to which team?"
          choices={teams.map((team) => ({ id: team.id, label: `${team.shortName}· ${team.name}` }))}
          selectedChoiceId={defaultId ?? undefined}
        />
      ),
    }).catch(() => undefined);
    return teams.find((team) => team.id === id) ?? null;
  }, [dialog, pluginRegistry, teams]);

  const savedFor = useCallback((entry: GalleryEntry) => (entry.index !== null ? layouts[entry.index] ?? null : null), [layouts]);

  const contentFor = useCallback((entry: GalleryEntry) => {
    // The active tab's live state is the freshest copy of it.
    if (entry.index === activeIndex) return { layout: currentLayout, paneState: currentPaneState };
    const saved = savedFor(entry);
    return saved
      ? { layout: saved.layout, paneState: (saved.paneState ?? {}) as typeof currentPaneState }
      : { layout: entry.layout, paneState: entry.paneState };
  }, [activeIndex, currentLayout, currentPaneState, savedFor]);

  const pullTeamUpdates = useCallback(async (entry: GalleryEntry) => {
    const saved = savedFor(entry);
    const origin = saved?.origin;
    if (entry.index === null || !origin) return;
    setPublishing(true);
    try {
      const cloud = await apiClient.getCloudLayout(origin.layoutId);
      if (!cloud) {
        pluginRegistry.notify({ body: "This team layout no longer exists. The tab stays as a personal copy.", type: "info" });
        dispatch({ type: "SET_LAYOUT_ORIGIN", index: entry.index, origin: null });
        return;
      }
      const nextOrigin = originFromEntry(cloud);
      if (!nextOrigin) return;
      rememberLayoutRequirements(cloud.id, cloud.requires);
      const installed = materializeMarketplaceLayout(cloud);
      dispatch({
        type: "REPLACE_LAYOUT_CONTENT",
        index: entry.index,
        layout: installed.layout,
        paneState: installed.paneState,
        origin: nextOrigin,
        name: cloud.name,
      });
      teamLayouts.upsert(cloud);
      pluginRegistry.notify({ body: `Pulled "${cloud.name}" r${cloud.revision}`, type: "success" });
    } catch (error) {
      pluginRegistry.notify({ body: error instanceof Error ? error.message : "Could not pull the team layout.", type: "error" });
    } finally {
      setPublishing(false);
    }
  }, [dispatch, pluginRegistry, savedFor, teamLayouts]);

  const resolveConflict = useCallback(async (entry: GalleryEntry, remoteRevision: number): Promise<"copy" | "overwrite" | "discard" | null> => {
    const choice = await dialog.prompt<string>({
      closeOnClickOutside: false,
      content: (context: unknown) => (
        <ChoiceDialog
          {...(context as PromptContext<string>)}
          title={`${entry.team?.name ?? "The team"} published r${remoteRevision} since you pulled`}
          choices={[
            { id: "copy", label: "Save mine as a personal copy, then pull", description: "Keeps both. Your version becomes an unlinked tab." },
            { id: "overwrite", label: "Overwrite with mine", description: `Publishes your content as r${remoteRevision + 1}.` },
            { id: "discard", label: "Discard mine and pull", description: "Your local changes are lost." },
          ]}
          selectedChoiceId="copy"
        />
      ),
    }).catch(() => undefined);
    return choice === "copy" || choice === "overwrite" || choice === "discard" ? choice : null;
  }, [dialog]);

  const publishToTeam = useCallback(async (entry: GalleryEntry) => {
    if (!signedIn) {
      requestSignIn();
      return;
    }
    if (entry.index === null) return;
    const saved = savedFor(entry);
    const content = contentFor(entry);
    const payload = publishableMarketplaceLayout(content.layout, content.paneState, panes);
    const requires = requirementsFor(content.layout);
    const origin = saved?.origin;

    setPublishing(true);
    try {
      if (origin) {
        const publish = async (expectedRevision: number | undefined) => apiClient.publishLayoutRevision(origin.layoutId, payload, {
          expectedRevision,
          requires,
          name: entry.name,
        });
        let published: CloudLayoutEntry;
        try {
          published = await publish(origin.revision);
        } catch (error) {
          if (!(error instanceof LayoutRevisionConflictError)) throw error;
          const choice = await resolveConflict(entry, error.currentRevision);
          if (!choice) return;
          if (choice === "overwrite") {
            published = await publish(error.currentRevision);
          } else {
            if (choice === "copy") {
              dispatch({ type: "DUPLICATE_LAYOUT", index: entry.index });
              dispatch({ type: "SET_LAYOUT_ORIGIN", index: layouts.length, origin: null });
            }
            await pullTeamUpdates(entry);
            return;
          }
        }
        const nextOrigin = originFromEntry(published);
        if (nextOrigin) dispatch({ type: "SET_LAYOUT_ORIGIN", index: entry.index, origin: nextOrigin });
        teamLayouts.upsert(published);
        pluginRegistry.notify({ body: `Published "${published.name}" r${published.revision} to ${entry.team?.name ?? "the team"}`, type: "success" });
        return;
      }

      const team = await chooseTeam();
      if (!team) return;
      const name = await promptName({
        title: `Publish to ${team.name}`,
        label: "Layout name",
        confirmLabel: "Publish to team",
        initialValue: entry.name,
      });
      if (!name) return;
      const published = await apiClient.publishTeamLayout(team.id, name, payload, { requires });
      const nextOrigin = originFromEntry(published);
      if (nextOrigin) dispatch({ type: "SET_LAYOUT_ORIGIN", index: entry.index, origin: nextOrigin });
      if (name !== entry.name) dispatch({ type: "RENAME_LAYOUT", index: entry.index, name });
      teamLayouts.upsert(published);
      pluginRegistry.notify({ body: `Published "${name}" to ${team.name}. This tab is now linked.`, type: "success" });
    } catch (error) {
      pluginRegistry.notify({ body: error instanceof Error ? error.message : "Could not publish to the team.", type: "error" });
    } finally {
      setPublishing(false);
    }
  }, [chooseTeam, contentFor, dispatch, layouts.length, panes, pluginRegistry, promptName, pullTeamUpdates, requestSignIn, requirementsFor, resolveConflict, savedFor, signedIn, teamLayouts]);

  const unlink = useCallback((entry: GalleryEntry) => {
    if (entry.index === null || !savedFor(entry)?.origin) return;
    dispatch({ type: "SET_LAYOUT_ORIGIN", index: entry.index, origin: null });
    pluginRegistry.notify({ body: `"${entry.name}" is a personal layout now.`, type: "success" });
  }, [dispatch, pluginRegistry, savedFor]);

  const newLayout = useCallback(async () => {
    const name = await promptName({
      title: "New Layout",
      label: "Layout name",
      confirmLabel: "Create Layout",
    });
    if (!name) return;
    close();
    dispatch({ type: "NEW_LAYOUT", name });
    pluginRegistry.notify({ body: `Layout "${name}" created`, type: "success" });
  }, [close, dispatch, pluginRegistry, promptName]);

  const renameLayout = useCallback(async (entry: GalleryEntry) => {
    if (entry.index === null) return;
    const name = await promptName({
      title: "Rename Layout",
      label: "New name",
      confirmLabel: "Rename Layout",
      initialValue: entry.name,
    });
    if (!name || name === entry.name) return;
    dispatch({ type: "RENAME_LAYOUT", index: entry.index, name });
  }, [dispatch, promptName]);

  const duplicateLayout = useCallback((entry: GalleryEntry) => {
    if (entry.index === null) return;
    close();
    dispatch({ type: "DUPLICATE_LAYOUT", index: entry.index });
    pluginRegistry.notify({ body: `Layout "${entry.name}" duplicated`, type: "success" });
  }, [close, dispatch, pluginRegistry]);

  const deleteLayout = useCallback(async (entry: GalleryEntry) => {
    if (entry.index === null || layouts.length <= 1) return;
    const confirmed = await dialog.prompt<boolean>({
      closeOnClickOutside: true,
      content: (context: unknown) => (
        <ConfirmDialog
          {...(context as PromptContext<boolean>)}
          title="Delete Layout"
          body={[`Delete layout "${entry.name}"? This cannot be undone.`]}
          confirmLabel="Delete Layout"
          cancelLabel="Cancel"
          width={48}
        />
      ),
    }).catch(() => false);
    if (confirmed !== true) return;
    dispatch({ type: "DELETE_LAYOUT", index: entry.index });
    pluginRegistry.notify({ body: `Layout "${entry.name}" deleted`, type: "success" });
  }, [dialog, dispatch, layouts.length, pluginRegistry]);

  const copyLink = useCallback((entry: GalleryEntry) => {
    if (!entry.marketplaceId) return;
    void renderer.copyText(publicMarketplaceLayoutUrl(entry.marketplaceId)).then(() => {
      pluginRegistry.notify({ body: "Layout link copied", type: "success" });
    }).catch(() => {
      pluginRegistry.notify({ body: "Could not copy the layout link.", type: "error" });
    });
  }, [pluginRegistry, renderer]);

  const publishCurrent = useCallback(async () => {
    if (!signedIn) {
      requestSignIn();
      return;
    }
    const name = layouts[activeIndex]?.name || "Community Layout";
    const confirmed = await dialog.prompt<boolean>({
      closeOnClickOutside: true,
      content: (context: unknown) => (
        <ConfirmDialog
          {...(context as PromptContext<boolean>)}
          title="Publish Current Layout"
          body={[
            `Publish "${name}" to Discover?`,
            "Pane setup, queries, chart views, drawings, and portable pane state will be public.",
            "Credentials, accounts, portfolios, and fields marked private are excluded.",
          ]}
          confirmLabel="Publish Layout"
          cancelLabel="Cancel"
          confirmVariant="primary"
          width={52}
        />
      ),
    }).catch(() => false);
    if (confirmed !== true) return;
    setPublishing(true);
    try {
      const item = await discover.publish(
        name,
        publishableMarketplaceLayout(currentLayout, currentPaneState, panes),
      );
      try {
        await renderer.copyText(publicMarketplaceLayoutUrl(item.id));
        pluginRegistry.notify({ body: `Layout "${name}" published · link copied`, type: "success" });
      } catch {
        pluginRegistry.notify({ body: `Layout "${name}" published`, type: "success" });
      }
    } catch (error) {
      pluginRegistry.notify({
        body: error instanceof Error ? error.message : "Could not publish this layout.",
        type: "error",
      });
    } finally {
      setPublishing(false);
    }
  }, [activeIndex, currentLayout, currentPaneState, dialog, discover, layouts, panes, pluginRegistry, renderer, requestSignIn, signedIn]);

  useShortcut((event) => {
    if (event.name !== "escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (detailId) setDetailId(null);
    else close();
  }, { enabled: focused && !dialogOpen, phase: "before", allowEditable: true, scope: "layout-gallery" });

  const controller: LayoutGalleryController = {
    query,
    setQuery,
    owned,
    community,
    entries,
    selectedId,
    select: setSelectedId,
    detail,
    openDetail: (entry) => {
      setSelectedId(entry.id);
      setDetailId(entry.id);
    },
    closeDetail: () => setDetailId(null),
    activate,
    install,
    discover,
    teamSections,
    teamLayouts,
    publishToTeam,
    pullTeamUpdates,
    unlink,
    teams,
    signedIn,
    requestSignIn,
    publishCurrent,
    copyLink,
    publishing,
    newLayout,
    renameLayout,
    duplicateLayout,
    deleteLayout,
    canDelete: layouts.length > 1,
    close,
    panes,
    missingPaneIds: (layout) => missingPaneIds(layout, panes),
  };

  return useUiHost().kind === "desktop-web"
    ? (
      <LayoutGalleryDesktop
        controller={controller}
        focused={focused}
        width={width}
        height={height}
      />
    )
    : (
      <LayoutGalleryTerminal
        controller={controller}
        dialogOpen={dialogOpen}
        focused={focused}
        width={width}
        height={height}
      />
    );
}
