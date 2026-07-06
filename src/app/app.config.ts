import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withPreloading, PreloadAllModules } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { registerLocaleData } from '@angular/common';
import localeEsCO from '@angular/common/locales/es-CO';

import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { authInterceptor } from './core/interceptors/auth.interceptor';

registerLocaleData(localeEsCO);

// Lucide icons — registro global para standalone components
import { LUCIDE_ICONS, LucideIconProvider } from 'lucide-angular';
import {
  ChefHat, LayoutDashboard, ClipboardList, UtensilsCrossed, Armchair,
  Package, Users, ChartBar, Settings, LogOut, Menu, X,
  Calendar, Sun, Moon, Bell, ChevronDown, ChevronLeft, ChevronRight,
  DollarSign, Receipt, Star, TrendingUp, TrendingDown, ChartPie, Eye,
  Search, Plus, Minus, Trash2, Printer, CreditCard, Flame, NotebookPen, Send,
  CirclePlus, Pencil, Loader, Leaf, Folder, ToggleRight, ToggleLeft,
  DoorOpen, Clock3,
  CheckCircle, XCircle, RotateCw, FolderPlus, Save,
  AlertTriangle, Bike, Wallet, Play, PlusCircle, Square, Banknote,
  Home, Phone, PhoneCall, MapPin, User, StickyNote, ShoppingBag,
  Copy, ArrowLeft, Lock, Truck, MessageCircle, Facebook, Instagram, CheckSquare, ExternalLink,
  Utensils, Coffee, FolderX, Globe, Mail, ArrowRight
} from 'lucide-angular';

const icons = {
  ChefHat, LayoutDashboard, ClipboardList, UtensilsCrossed, Armchair,
  Package, Users, ChartBar, Settings, LogOut, Menu, X,
  Calendar, Sun, Moon, Bell, ChevronDown, ChevronLeft, ChevronRight,
  DollarSign, Receipt, Star, TrendingUp, TrendingDown, ChartPie, Eye,
  Search, Plus, Minus, Trash2, Printer, CreditCard, Flame, NotebookPen, Send,
  CirclePlus, Pencil, Loader, Leaf, Folder, ToggleRight, ToggleLeft,
  DoorOpen, Clock3,
  CheckCircle, XCircle, RotateCw, FolderPlus, Save,
  AlertTriangle, Bike, Wallet, Play, PlusCircle, Square, Banknote,
  Home, Phone, PhoneCall, MapPin, User, StickyNote, ShoppingBag,
  Copy, ArrowLeft, Lock, Truck, MessageCircle, Facebook, Instagram, CheckSquare, ExternalLink,
  Utensils, Coffee, FolderX, Globe, Mail, ArrowRight
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // PreloadAllModules: descarga los chunks lazy en segundo plano tras la
    // carga inicial, para que cambiar de vista no espere el fetch del chunk.
    provideRouter(routes, withPreloading(PreloadAllModules)),
    provideHttpClient(
      withFetch(),
      withInterceptors([authInterceptor]),
    ),
    provideClientHydration(withEventReplay()),
    { provide: LOCALE_ID, useValue: 'es-CO' },
    { provide: LUCIDE_ICONS, multi: true, useValue: new LucideIconProvider(icons) },
  ],
};
