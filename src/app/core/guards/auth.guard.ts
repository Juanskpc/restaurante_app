import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';

import { AuthService } from '../services/auth.service';
import { PaletteService } from '../theme/palette.service';

type AdminSessionTransfer = {
  source: string;
  token: string;
  id_negocio?: number;
  ts?: number;
};

/**
 * Guard funcional que protege las rutas de la aplicación de negocio.
 *
 * Flujo:
 *  1. Si ya hay sesión activa en memoria → permite acceso inmediato.
 *  2. Si llega token temporal desde admin_app (window.name) → valida y persiste sesión local.
 *  3. Si hay token en localStorage propio (refresh de página) → valida contra backend.
 *  4. Sin sesión/token local → redirige al admin_app login.
 *
 * Además, si la sesión tiene paleta, la aplica automáticamente.
 */

export const authGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const paletteService = inject(PaletteService);
  const platformId = inject(PLATFORM_ID);

  // En SSR no hay sesión ni localStorage → no bloquear
  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  // --- 1. Sesión existente en memoria → acceso inmediato ---
  if (authService.isAuthenticated()) {
    applyPaletteIfAvailable(authService, paletteService);
    return true;
  }

  // --- 2. Token temporal desde admin_app (sin query params) ---
  const transfer = readAdminSessionTransfer();
  if (transfer?.token) {
    const valid = await authService.validateAndSetToken(transfer.token);
    clearAdminSessionTransfer();

    if (valid) {
      if (typeof transfer.id_negocio === 'number') {
        authService.setNegocioActivo(transfer.id_negocio);
      }
      applyPaletteIfAvailable(authService, paletteService);
      return true;
    }

    authService.logout();
    return false;
  }

  // --- 3. Token en localStorage propio (refresh de página) ---
  const storedToken = authService.getAccessToken();
  if (storedToken) {
    const valid = await authService.validateAndSetToken(storedToken);
    if (valid) {
      applyPaletteIfAvailable(authService, paletteService);
      return true;
    }
    // Token expirado/inválido → limpiar y redirigir
    authService.logout();
    return false;
  }

  // --- 4. Sin sesión ni token → redirigir ---
  redirectToAdmin(platformId);
  return false;
};

// ============================================================
// Helpers
// ============================================================

function applyPaletteIfAvailable(
  auth: AuthService,
  palette: PaletteService,
): void {
  const negocio = auth.negocio();
  if (negocio?.paleta) {
    palette.applyPalette(negocio.paleta as any);
  }
}

function redirectToAdmin(platformId: object): void {
  if (isPlatformBrowser(platformId)) {
    const adminUrl = 'http://localhost:4002';
    window.location.href = `${adminUrl}/auth/login`;
  }
}

function readAdminSessionTransfer(): AdminSessionTransfer | null {
  if (typeof window === 'undefined' || !window.name) return null;

  try {
    const parsed = JSON.parse(window.name) as AdminSessionTransfer;
    if (parsed?.source !== 'admin_app') return null;
    if (typeof parsed.token !== 'string' || parsed.token.length === 0) return null;

    if (typeof parsed.ts === 'number') {
      const ageMs = Date.now() - parsed.ts;
      if (ageMs > 5 * 60 * 1000) return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function clearAdminSessionTransfer(): void {
  if (typeof window !== 'undefined') {
    window.name = '';
  }
}
