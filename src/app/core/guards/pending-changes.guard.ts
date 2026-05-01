import { CanDeactivateFn } from '@angular/router';

export interface PendingChangesComponent {
  canDeactivate: () => boolean | Promise<boolean>;
}

export const pendingChangesGuard: CanDeactivateFn<PendingChangesComponent> = (component) => {
  if (component?.canDeactivate) {
    return component.canDeactivate();
  }
  return true;
};
