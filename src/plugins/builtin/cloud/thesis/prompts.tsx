import { ChoiceDialog, ConfirmDialog, type ChoiceDialogChoice } from "../../../../components";
import {
  PaneTemplateInputStep,
  PaneTemplateSelectStep,
  PaneTemplateTextareaStep,
} from "../../../../components/pane-template-wizard";
import type { WizardStep } from "../../../../types/plugin";
import type { DialogApi, PromptContext } from "../../../../ui/dialog";

/**
 * Thin wrappers over the dialog host so the thesis flows read as a sequence
 * of questions. Every prompt resolves `undefined` when the person backs out.
 */

export async function promptText(dialog: DialogApi, step: Omit<WizardStep, "key" | "type"> & { key?: string }): Promise<string | undefined> {
  const wizardStep: WizardStep = { key: step.key ?? "value", type: "text", ...step };
  const value = await dialog.prompt<string>({
    content: (context: PromptContext<string>) => <PaneTemplateInputStep {...context} step={wizardStep} />,
  }).catch(() => undefined);
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed || (step.required === false ? "" : undefined);
}

export async function promptTextarea(dialog: DialogApi, step: Omit<WizardStep, "key" | "type"> & { key?: string }): Promise<string | undefined> {
  const wizardStep: WizardStep = { key: step.key ?? "value", type: "textarea", ...step };
  const value = await dialog.prompt<string>({
    content: (context: PromptContext<string>) => <PaneTemplateTextareaStep {...context} step={wizardStep} />,
  }).catch(() => undefined);
  // The textarea step resolves "" for escape; an empty body is a cancel here.
  return value ? value.trim() : undefined;
}

export async function promptSelect(
  dialog: DialogApi,
  step: { label: string; options: Array<{ label: string; value: string }>; defaultValue?: string; body?: string[] },
): Promise<string | undefined> {
  const wizardStep: WizardStep = { key: "choice", type: "select", ...step };
  const value = await dialog.prompt<string>({
    content: (context: PromptContext<string>) => <PaneTemplateSelectStep {...context} step={wizardStep} />,
  }).catch(() => undefined);
  return value || undefined;
}

export async function promptChoice(
  dialog: DialogApi,
  title: string,
  choices: ChoiceDialogChoice[],
  selectedChoiceId?: string,
): Promise<string | undefined> {
  const value = await dialog.prompt<string>({
    closeOnClickOutside: true,
    content: (context: PromptContext<string>) => (
      <ChoiceDialog {...context} title={title} choices={choices} selectedChoiceId={selectedChoiceId} />
    ),
  }).catch(() => undefined);
  return value || undefined;
}

export async function promptNumber(
  dialog: DialogApi,
  step: { label: string; defaultValue?: number; placeholder?: string; body?: string[]; min?: number; max?: number; integer?: boolean },
): Promise<number | undefined> {
  for (;;) {
    const raw = await promptText(dialog, {
      label: step.label,
      placeholder: step.placeholder,
      body: step.body,
      defaultValue: step.defaultValue === undefined ? undefined : String(step.defaultValue),
    });
    if (raw === undefined) return undefined;
    const value = Number(raw.replace(/[,%x\s]/g, ""));
    const valid = Number.isFinite(value)
      && (!step.integer || Number.isInteger(value))
      && (step.min === undefined || value >= step.min)
      && (step.max === undefined || value <= step.max);
    if (valid) return value;
  }
}

export async function confirm(
  dialog: DialogApi,
  options: { title: string; body: string | string[]; confirmLabel: string; danger?: boolean },
): Promise<boolean> {
  const value = await dialog.prompt<boolean>({
    content: (context: PromptContext<boolean>) => (
      <ConfirmDialog
        {...context}
        title={options.title}
        body={options.body}
        confirmLabel={options.confirmLabel}
        confirmVariant={options.danger ? "danger" : "primary"}
      />
    ),
  }).catch(() => undefined);
  return value === true;
}
