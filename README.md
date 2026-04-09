# Negocio App

Aplicación Angular para los negocios (restaurantes, barberías, financieras, etc.).  
Comparte la misma versión de Angular, dependencias y configuración base que `admin_app_v21`.

## Desarrollo

```bash
npm install
npm start          # ng serve → http://localhost:4002
```

## Build

```bash
npm run build
npm run serve:ssr:negocio-app
```

## Sistema de paletas de colores

La identidad visual de cada negocio es configurable.  
Se define mediante CSS custom properties inyectadas dinámicamente desde la tabla `general.gener_paleta_color`.  
El administrador del negocio elige una paleta y esta se aplica en tiempo real.

Consultar `src/app/core/theme/` para los servicios de tema y paleta.
