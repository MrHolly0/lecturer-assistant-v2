import { Folder } from "lucide-react";
import { ORGANIZATION_ICONS } from "./organizationIcons";

export function OrganizationUnitIcon({
  icon,
  size = 20,
  className
}: {
  icon?: string | null;
  size?: number;
  className?: string;
}) {
  const Icon = ORGANIZATION_ICONS.find((option) => option.value === icon)?.Icon ?? Folder;
  return <Icon size={size} className={className} aria-hidden="true" />;
}
