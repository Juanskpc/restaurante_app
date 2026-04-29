import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
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
  Calendar, Sun, Moon, Bell, ChevronDown, ChevronRight,
  DollarSign, Receipt, Star, TrendingUp, TrendingDown, ChartPie, Eye,
  Search, Plus, Minus, Trash2, Printer, CreditCard, Flame, NotebookPen, Send,
  CirclePlus, Pencil, Loader, Leaf, Folder, ToggleRight, ToggleLeft,
  DoorOpen, Clock3,
  CheckCircle, XCircle, RotateCw, FolderPlus, Save,
  AlertTriangle, Bike, Wallet, Play, PlusCircle, Square, Banknote,
  Home, Phone, PhoneCall, MapPin, User, StickyNote, ShoppingBag,
  Copy, ArrowLeft, Lock, Truck
} from 'lucide-angular';

const icons = {
  ChefHat, LayoutDashboard, ClipboardList, UtensilsCrossed, Armchair,
  Package, Users, ChartBar, Settings, LogOut, Menu, X,
  Calendar, Sun, Moon, Bell, ChevronDown, ChevronRight,
  DollarSign, Receipt, Star, TrendingUp, TrendingDown, ChartPie, Eye,
  Search, Plus, Minus, Trash2, Printer, CreditCard, Flame, NotebookPen, Send,
  CirclePlus, Pencil, Loader, Leaf, Folder, ToggleRight, ToggleLeft,
  DoorOpen, Clock3,
  CheckCircle, XCircle, RotateCw, FolderPlus, Save,
  AlertTriangle, Bike, Wallet, Play, PlusCircle, Square, Banknote,
  Home, Phone, PhoneCall, MapPin, User, StickyNote, ShoppingBag,
  Copy, ArrowLeft, Lock, Truck
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(
      withFetch(),
      withInterceptors([authInterceptor]),
    ),
    provideClientHydration(withEventReplay()),
    { provide: LOCALE_ID, useValue: 'es-CO' },
    { provide: LUCIDE_ICONS, multi: true, useValue: new LucideIconProvider(icons) },
  ],
};
