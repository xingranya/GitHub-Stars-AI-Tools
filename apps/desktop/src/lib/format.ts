export function optionalRequestText(value: string) {
  const normalized = value.trim();

  return normalized.length > 0 ? normalized : null;
}

export function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString('zh-CN');
}

export function compactNumber(value: number) {
  if (value >= 1000) {
    return `${Number((value / 1000).toFixed(value >= 10000 ? 0 : 1))}k`;
  }

  return value.toLocaleString();
}
