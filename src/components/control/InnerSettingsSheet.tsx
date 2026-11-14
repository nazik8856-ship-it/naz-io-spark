// Inner Control: the gear. Everything that is not the page's three sections lives here, closed by default:
// the account, importing a project, approvals and incidents, the controls (strictness, retention, notifications, dry run)
// and the list of every other Inner Control page.
import { ArrowLeft, FolderInput } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import ProjectSwitcher from "@/components/control/ProjectSwitcher";
import SpendSafetyStatusBadge from "@/components/control/SpendSafetyStatusBadge";
import StrictnessPanel from "@/components/control/StrictnessPanel";
import RetentionPanel from "@/components/control/RetentionPanel";
import PolicyOverviewPanel from "@/components/control/PolicyOverviewPanel";
import NotificationPreferencesPanel from "@/components/control/NotificationPreferencesPanel";
import DryRunToggle from "@/components/control/DryRunToggle";
import { ControlPagesGrid } from "@/components/control/dashboard/ControlPagesMenu";

export default function InnerSettingsSheet({
  open, onOpenChange, onNavigate, onImport, badges, approvals, incidents, dryRun, onDryRun,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onNavigate: (path: string) => void;
  onImport: () => void;
  badges: Record<string, number>;
  approvals: number;
  incidents: number;
  dryRun: boolean;
  onDryRun: (v: boolean) => void;
}) {
  const go = (path: string) => { onOpenChange(false); onNavigate(path); };
  const row = "flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-zinc-100 hover:bg-white/[0.07]";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto border-white/10 bg-[#050813] p-0 text-white sm:max-w-md" data-testid="inner-settings">
        <SheetHeader className="border-b border-white/10 px-5 py-4 text-left">
          <SheetTitle className="text-white">Inner Control settings</SheetTitle>
          <SheetDescription className="text-zinc-500">Controls, other pages and your account.</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 p-5">
          <div className="space-y-2">
            <button onClick={() => go("/dashboard")} className={row}><span className="flex items-center gap-2"><ArrowLeft className="h-4 w-4 text-zinc-400" /> Back to dashboard</span></button>
            <button onClick={() => { onOpenChange(false); onImport(); }} className={row} data-testid="import-project-button"><span className="flex items-center gap-2"><FolderInput className="h-4 w-4 text-amber-300" /> Import project</span><span className="text-xs text-zinc-500">Bring an external project under your rules</span></button>
            <button onClick={() => go("/control-system/approvals")} className={row}><span>Approvals</span>{approvals > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-black">{approvals}</span>}</button>
            <button onClick={() => go("/control-system/incidents")} className={row}><span>Incidents</span>{incidents > 0 && <span className="rounded-full bg-rose-400 px-1.5 text-[10px] font-bold text-black">{incidents}</span>}</button>
            <ProjectSwitcher />
          </div>

          <div>
            <h3 className="mb-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500">Controls</h3>
            <div className="-mx-1 overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
              <SpendSafetyStatusBadge />
              <StrictnessPanel />
              <RetentionPanel />
              <PolicyOverviewPanel />
              <NotificationPreferencesPanel />
              <DryRunToggle on={dryRun} onChange={onDryRun} />
            </div>
          </div>

          <div>
            <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">All pages</h3>
            <ControlPagesGrid badges={badges} onNavigate={go} columns="" />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
