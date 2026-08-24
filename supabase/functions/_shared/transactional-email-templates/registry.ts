/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as welcomeNazai } from './welcome-nazai.tsx'
import { template as agentNotification } from './agent-notification.tsx'
import { template as controlDigest } from './control-digest.tsx'
import { template as controlWeeklyTrend } from './control-weekly-trend.tsx'
import { template as accountInvite } from './account-invite.tsx'
import { template as controlMonthlyReport } from './control-monthly-report.tsx'
import { template as criticalAlert } from './critical-alert.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'welcome-nazai': welcomeNazai,
  'agent-notification': agentNotification,
  'control-digest': controlDigest,
  'control-weekly-trend': controlWeeklyTrend,
  'account-invite': accountInvite,
  'control-monthly-report': controlMonthlyReport,
  'critical-alert': criticalAlert,
}
