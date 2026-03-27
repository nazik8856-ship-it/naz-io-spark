import { Clock, FolderOpen, Trash2, PlusCircle, Pencil, Eye, Share2, Download, Globe, Lightbulb } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";

const navItems = [
  { title: "Create", url: "/dashboard/create", icon: PlusCircle },
  { title: "Recently", url: "/dashboard", icon: Clock },
  { title: "All Projects", url: "/dashboard/projects", icon: FolderOpen },
  { title: "Trash", url: "/dashboard/trash", icon: Trash2 },
];

export type DashboardContext = "prompt" | "preview" | "edit" | "browse";

interface DashboardSidebarProps {
  context?: DashboardContext;
  onAction?: (action: string) => void;
}

const contextSections: Record<DashboardContext, { label: string; items: { title: string; icon: React.ElementType; action: string }[] }> = {
  prompt: {
    label: "Getting Started",
    items: [
      { title: "Idea Helper", icon: Lightbulb, action: "idea-helper" },
    ],
  },
  preview: {
    label: "Quick Actions",
    items: [
      { title: "Edit & Improve", icon: Pencil, action: "edit" },
      { title: "Publish Live", icon: Globe, action: "publish" },
      { title: "Share Link", icon: Share2, action: "share" },
      { title: "Download", icon: Download, action: "download" },
    ],
  },
  edit: {
    label: "Editing",
    items: [
      { title: "Preview", icon: Eye, action: "preview" },
      { title: "Publish Live", icon: Globe, action: "publish" },
      { title: "Share Link", icon: Share2, action: "share" },
    ],
  },
  browse: { label: "", items: [] },
};

export function DashboardSidebar({ context = "browse", onAction }: DashboardSidebarProps) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const currentPath = location.pathname;

  const isActive = (path: string) => currentPath === path;
  const ctxSection = contextSections[context];

  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-card/40 backdrop-blur-xl">
      <SidebarContent className="pt-20">
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground/70">
            Projects
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.url)}
                    tooltip={item.title}
                  >
                    <NavLink
                      to={item.url}
                      end
                      className="hover:bg-muted/50"
                      activeClassName="bg-muted text-primary font-medium"
                    >
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {ctxSection.items.length > 0 && (
          <>
            <SidebarSeparator className="my-2" />
            <SidebarGroup>
              {!collapsed && (
                <SidebarGroupLabel className="text-xs uppercase tracking-wider text-primary/70">
                  {ctxSection.label}
                </SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                <SidebarMenu>
                  {ctxSection.items.map((item) => (
                    <SidebarMenuItem key={item.action}>
                      <SidebarMenuButton
                        tooltip={item.title}
                        onClick={() => onAction?.(item.action)}
                        className="hover:bg-primary/10 hover:text-primary cursor-pointer"
                      >
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
