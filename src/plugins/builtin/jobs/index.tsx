import type { PluginModule } from "../plugin-module";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { resetJobsCache } from "./client";
import { hiringMoversHeadless, jobsHeadless } from "./headless";
import { JOBS_PANE_ID, JobsPane, JobsResearchTab } from "./pane";

export { hiringMoversHeadless, jobsHeadless } from "./headless";

const description =
  "Hiring read from the company's own careers system: open roles over time, by function and location, new roles, pay ranges.";

export const jobsModule: PluginModule = {
  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "jobs",
      name: "Hiring",
      order: 37,
      component: JobsResearchTab,
      isVisible: ({ ticker }) => !!ticker,
    });
  },

  dispose() {
    resetJobsCache();
  },

  panes: [
    {
      id: JOBS_PANE_ID,
      name: "Hiring",
      icon: "J",
      component: JobsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 110, height: 34 },
      tableExport: true,
    },
  ],

  paneTemplates: [
    {
      ...createTickerSurfacePaneTemplate({
        id: "jobs-pane",
        paneId: JOBS_PANE_ID,
        label: "Hiring",
        description,
        keywords: ["jobs", "hiring", "headcount", "careers", "openings", "roles", "recruiting", "layoffs", "workforce"],
        shortcut: "JOBS",
        publicShare: true,
      }),
      headless: jobsHeadless,
    },
    // Across coverage, unbound to a ticker.
    {
      id: "hiring-movers-pane",
      paneId: JOBS_PANE_ID,
      label: "Hiring Movers",
      description: "Who is hiring most and who is changing pace, across every company under coverage.",
      keywords: ["hiring", "jobs", "movers", "headcount", "layoffs", "recruiting"],
      shortcut: { prefix: "HIRE" },
      headless: hiringMoversHeadless,
      createInstance: () => ({ placement: "floating", title: "Hiring Movers" }),
    },
  ],
};
