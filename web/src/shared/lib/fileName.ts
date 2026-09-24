export function titleFromFileName(fileName: string): string {
  const cleanName = fileName.trim() || "Материалы";
  const dot = cleanName.lastIndexOf(".");
  return dot > 0 ? cleanName.slice(0, dot) : cleanName;
}
