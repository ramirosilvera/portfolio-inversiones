// Dispara la descarga de un archivo en el navegador (sin subir nada a ningún lado) — el mismo
// mecanismo Blob + <a download> que ya usaba backup.ts, extraído acá para no duplicarlo con la
// exportación de renta fija (y cualquier export futuro que necesite lo mismo).
export function descargarTexto(contenido: string, filename: string, mimeType: string) {
  const blob = new Blob([contenido], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
