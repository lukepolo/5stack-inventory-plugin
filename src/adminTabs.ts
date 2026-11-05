// The settings console's tabs. One list, two readers: the console's side nav
// draws it, and App names the open tab in the panel's breadcrumbs ("Inventory ›
// Settings › 3D Models") — two copies would be two names for one page.
// `key` is the path under /admin; "" is the console's first page.
export const ADMIN_TABS = [
  { key: "", label: "Game Server" },
  { key: "assets", label: "Asset Cache" },
  { key: "prices", label: "Prices" },
  { key: "models", label: "3D Models" },
  { key: "tests", label: "Skin Tests" },
  { key: "dev", label: "Developer" },
] as const;

/** The tab a section opens — an unknown one is the first page, as the console shows it. */
export const adminTabLabel = (section: string): string =>
  (ADMIN_TABS.find((tab) => tab.key === section) ?? ADMIN_TABS[0]).label;
