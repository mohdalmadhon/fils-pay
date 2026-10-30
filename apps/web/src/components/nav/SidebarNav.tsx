import { Fragment } from "react";
import { NavLink } from "react-router-dom";
import { icons } from "../art/Icons.js";
import type { MerchantRole } from "../../types.js";
import { applyNavOrder, isDefaultNavOrder, type NavId } from "./navOrder.js";

export interface NavLinkDef {
  id: NavId;
  label: string;
  to: string;
  icon: React.ReactNode;
  /** The heading it sits under in the default order. */
  section: string;
  /** Roles that may see it; every role when absent. Webhooks and
   *  reconciliation are owner/finance-only server-side, so they are hidden
   *  from support rather than offered and then refused. */
  roles?: readonly MerchantRole[];
}

export const NAV_LINKS: readonly NavLinkDef[] = [
  { id: "overview", label: "Overview", to: "/dashboard/overview", icon: icons.overview, section: "Payments" },
  { id: "transactions", label: "Transactions", to: "/dashboard/transactions", icon: icons.transactions, section: "Payments" },
  { id: "payment-links", label: "Payment links", to: "/dashboard/payment-links", icon: icons.links, section: "Payments" },
  { id: "settlement", label: "Settlement", to: "/dashboard/settlement", icon: icons.settlement, section: "Money out" },
  {
    id: "reconciliation",
    label: "Reconciliation",
    to: "/dashboard/reconciliation",
    icon: icons.reconciliation,
    section: "Money out",
    roles: ["owner", "finance"],
  },
  { id: "webhooks", label: "Webhooks", to: "/dashboard/webhooks", icon: icons.webhooks, section: "Developers", roles: ["owner", "finance"] },
  { id: "settings", label: "Settings", to: "/dashboard/settings", icon: icons.settings, section: "You" },
];

/** The links this role may see, in the saved order (or the default). */
export function visibleNavLinks(role: MerchantRole | undefined, savedOrder: readonly NavId[] | null): NavLinkDef[] {
  // Before /me has loaded every link shows, as it always did.
  const allowed = NAV_LINKS.filter((link) => !link.roles || !role || link.roles.includes(role));
  const byId = new Map(allowed.map((link) => [link.id, link]));
  return applyNavOrder(
    allowed.map((link) => link.id),
    savedOrder,
  ).map((id) => byId.get(id)!);
}

interface SidebarNavProps {
  links: readonly NavLinkDef[];
}

/**
 * The sidebar's links. In the default order they sit under their section
 * headings, as before; once the merchant has arranged their own order the
 * headings would only repeat and interrupt it, so the list is shown plain.
 */
export function SidebarNav({ links }: SidebarNavProps) {
  const grouped = isDefaultNavOrder(links.map((link) => link.id));
  return (
    <nav className="dash-nav" aria-label="Main" data-tour="nav">
      {links.map((link, i) => (
        <Fragment key={link.id}>
          {grouped && link.section !== links[i - 1]?.section ? <span className="dash-nav-label">{link.section}</span> : null}
          <NavLink to={link.to}>
            {link.icon}
            {link.label}
          </NavLink>
        </Fragment>
      ))}
    </nav>
  );
}
