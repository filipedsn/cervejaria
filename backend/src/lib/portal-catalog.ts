export type CategoryItem = { categoria?: string | null };

export function isPortalCategoryAllowed(category: string | null | undefined, allowedCategories: string[] | null): boolean {
  if (allowedCategories === null) return true;
  return allowedCategories.includes(category?.trim() || 'Outros');
}

export function filterPortalCategories<T extends CategoryItem>(items: T[], allowedCategories: string[] | null): T[] {
  if (allowedCategories === null) return items;
  return items.filter((item) => isPortalCategoryAllowed(item.categoria, allowedCategories));
}
