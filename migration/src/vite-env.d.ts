/// <reference types="vite/client" />

// Inyectados por vite.config.ts (define) — __GIT_COMMIT__ viene de GITHUB_SHA en el workflow de
// deploy, 'local' en dev. Ver main.tsx: se usa como buster de la caché persistida en localStorage.
declare const __GIT_COMMIT__: string;
declare const __BUILD_TIME__: string;
