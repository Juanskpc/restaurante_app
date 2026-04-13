import { Injectable, signal } from '@angular/core';

export type UiFeedbackTone = 'success' | 'info' | 'warning' | 'error';

interface UiToast {
  id: number;
  tone: UiFeedbackTone;
  title: string;
  message: string;
  durationMs: number;
}

interface UiDialogState {
  kind: 'confirm' | 'alert';
  tone: UiFeedbackTone;
  title: string;
  message: string;
  confirmText: string;
  cancelText?: string;
  dismissible: boolean;
  resolve: (result: boolean) => void;
}

export interface UiConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: UiFeedbackTone;
  dismissible?: boolean;
}

export interface UiAlertOptions {
  title?: string;
  message: string;
  actionText?: string;
  tone?: UiFeedbackTone;
  dismissible?: boolean;
}

@Injectable({ providedIn: 'root' })
export class UiFeedbackService {
  readonly toasts = signal<UiToast[]>([]);
  readonly dialog = signal<UiDialogState | null>(null);

  private toastCounter = 0;
  private readonly toastTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly dialogQueue: UiDialogState[] = [];

  success(message: string, title = 'Proceso exitoso'): void {
    this.toast({ tone: 'success', title, message });
  }

  info(message: string, title = 'Informacion'): void {
    this.toast({ tone: 'info', title, message });
  }

  warning(message: string, title = 'Atencion'): void {
    this.toast({ tone: 'warning', title, message, durationMs: 4200 });
  }

  error(message: string, title = 'No se pudo completar la accion'): void {
    this.toast({ tone: 'error', title, message, durationMs: 5200 });
  }

  created(message = 'Datos guardados correctamente.'): void {
    this.success(message, 'Registro creado');
  }

  updated(message = 'Los datos fueron actualizados correctamente.'): void {
    this.success(message, 'Actualizacion completada');
  }

  deleted(message = 'El registro fue eliminado correctamente.'): void {
    this.success(message, 'Eliminacion completada');
  }

  inactivated(message = 'El registro fue inactivado correctamente.'): void {
    this.warning(message, 'Registro inactivado');
  }

  activated(message = 'El registro fue activado correctamente.'): void {
    this.success(message, 'Registro activado');
  }

  toast(options: {
    tone: UiFeedbackTone;
    title: string;
    message: string;
    durationMs?: number;
  }): void {
    const id = ++this.toastCounter;
    const durationMs = Math.max(1800, options.durationMs ?? 3600);

    this.toasts.update((current) => [
      ...current,
      {
        id,
        tone: options.tone,
        title: options.title,
        message: options.message,
        durationMs,
      },
    ]);

    const timer = setTimeout(() => this.dismissToast(id), durationMs);
    this.toastTimers.set(id, timer);
  }

  dismissToast(id: number): void {
    const timer = this.toastTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.toastTimers.delete(id);
    }

    this.toasts.update((current) => current.filter((toast) => toast.id !== id));
  }

  confirm(options: UiConfirmOptions): Promise<boolean> {
    return this.enqueueDialog({
      kind: 'confirm',
      title: options.title ?? 'Confirmar accion',
      message: options.message,
      confirmText: options.confirmText ?? 'Confirmar',
      cancelText: options.cancelText ?? 'Cancelar',
      tone: options.tone ?? 'warning',
      dismissible: options.dismissible ?? true,
    });
  }

  alert(options: UiAlertOptions | string): Promise<void> {
    const normalized = typeof options === 'string'
      ? { message: options }
      : options;

    return this.enqueueDialog({
      kind: 'alert',
      title: normalized.title ?? 'Aviso',
      message: normalized.message,
      confirmText: normalized.actionText ?? 'Entendido',
      tone: normalized.tone ?? 'info',
      dismissible: normalized.dismissible ?? true,
    }).then(() => undefined);
  }

  acceptDialog(): void {
    const active = this.dialog();
    if (!active) return;

    active.resolve(true);
    this.dialog.set(null);
    this.openNextDialog();
  }

  cancelDialog(): void {
    const active = this.dialog();
    if (!active) return;

    active.resolve(false);
    this.dialog.set(null);
    this.openNextDialog();
  }

  dismissDialog(): void {
    const active = this.dialog();
    if (!active || !active.dismissible) return;

    this.cancelDialog();
  }

  private enqueueDialog(options: Omit<UiDialogState, 'resolve'>): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const state: UiDialogState = {
        ...options,
        resolve,
      };

      if (!this.dialog()) {
        this.dialog.set(state);
        return;
      }

      this.dialogQueue.push(state);
    });
  }

  private openNextDialog(): void {
    const next = this.dialogQueue.shift() ?? null;
    this.dialog.set(next);
  }
}
