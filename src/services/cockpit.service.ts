import dayjs from 'dayjs';
import { dataStore } from '../store/dataStore';
import {
  CockpitOverview,
  CockpitWeekTrendPoint,
  CockpitAnomalyAlert,
  Professional,
  ReminderStage,
  professionalLabels,
  stageLabels,
  WeeklySummary,
} from '../types';

export class CockpitService {
  getOverview(
    weeks: number = 8,
    filter?: { projectId?: string; professional?: Professional }
  ): CockpitOverview {
    const histories = dataStore.getWeeklySummariesTrend(weeks).slice().reverse();
    const startDate = histories.length > 0 ? histories[0].weekStart : dayjs().subtract(weeks - 1, 'week').startOf('week').format('YYYY-MM-DD');
    const endDate = histories.length > 0 ? histories[histories.length - 1].weekEnd : dayjs().endOf('week').format('YYYY-MM-DD');

    const weeklyTrend: CockpitWeekTrendPoint[] = histories.map(s => this.buildTrendPoint(s, filter));

    let totalNewChange = 0, totalClosed = 0, totalOverdue = 0, totalRisk = 0, totalEstimatedAmount = 0;
    let handlingTotal = 0, handlingHandled = 0;
    let totalDurationDays = 0, durationSampleCount = 0;

    for (const p of weeklyTrend) {
      totalNewChange += p.newChangeCount;
      totalClosed += p.closedChangeCount;
      totalOverdue += p.overdueReminderCount;
      totalRisk += p.riskAlertCount;
      totalEstimatedAmount += p.totalEstimatedAmount;
    }

    const reminders: any[] = [
      ...Array.from(((dataStore as any).statusReminders?.values?.() as Iterable<any>) || []),
      ...Array.from(((dataStore as any).riskAlerts?.values?.() as Iterable<any>) || []),
    ];
    for (const r of reminders as any[]) {
      if (filter?.projectId && r.projectId !== filter.projectId) continue;
      handlingTotal++;
      if (r.handlingStatus === 'handled') handlingHandled++;
      if (r.handledAt && r.createdAt) {
        const dur = dayjs(r.handledAt).diff(dayjs(r.createdAt), 'day', true);
        if (dur > 0) { totalDurationDays += dur; durationSampleCount++; }
      }
    }

    const latest = weeklyTrend[weeklyTrend.length - 1];
    const previous = weeklyTrend.length >= 2 ? weeklyTrend[weeklyTrend.length - 2] : undefined;

    const weekOverWeek = {
      newChangeDelta: previous ? latest.newChangeCount - previous.newChangeCount : 0,
      closedDelta: previous ? latest.closedChangeCount - previous.closedChangeCount : 0,
      overdueDelta: previous ? latest.overdueReminderCount - previous.overdueReminderCount : 0,
      riskDelta: previous ? latest.riskAlertCount - previous.riskAlertCount : 0,
      amountDelta: previous ? latest.totalEstimatedAmount - previous.totalEstimatedAmount : 0,
    };

    const anomalyAlerts = this.buildAnomalyAlerts(latest, previous);
    const latestWeek = this.buildLatestWeek(latest, histories[histories.length - 1], filter);

    const projects = dataStore.getAllProjects();
    const topOverdueProjects = projects.map(p => {
      const related = reminders.filter((r: any) => r.projectId === p.id);
      const overdue = related.filter((r: any) =>
        ['overdue_unhandled'].includes(r.handlingStatus) ||
        (r.handlingDeadline && dayjs().isAfter(dayjs(r.handlingDeadline)) && r.handlingStatus !== 'handled')
      ).length;
      const total = related.length;
      return {
        projectId: p.id,
        projectName: p.name,
        overdueCount: overdue,
        totalCount: total,
        overdueRatio: total > 0 ? overdue / total : 0,
      };
    })
      .filter(x => x.totalCount > 0)
      .sort((a, b) => b.overdueCount - a.overdueCount)
      .slice(0, 5);

    const profMap = new Map<string, { risk: number; total: number }>();
    const allChanges = dataStore.getAllChanges();
    for (const c of allChanges) {
      if (filter?.projectId && c.projectId !== filter.projectId) continue;
      if (filter?.professional && c.professional !== filter.professional) continue;
      if (!profMap.has(c.professional)) profMap.set(c.professional, { risk: 0, total: 0 });
      profMap.get(c.professional)!.total++;
    }
    const risks: any[] = Array.from(((dataStore as any).riskAlerts?.values?.() as Iterable<any>) || []);
    for (const r of risks) {
      if (filter?.projectId && r.projectId !== filter.projectId) continue;
      if (r.professional) {
        if (!profMap.has(r.professional)) profMap.set(r.professional, { risk: 0, total: 0 });
        profMap.get(r.professional)!.risk += r.changeCount || 1;
      }
    }
    const topRiskProfessionals = Array.from(profMap.entries())
      .map(([k, v]) => ({
        key: k as Professional,
        label: (professionalLabels as any)[k] || k,
        riskCount: v.risk,
        totalCount: v.total,
      }))
      .sort((a, b) => b.riskCount - a.riskCount)
      .slice(0, 5);

    return {
      startDate,
      endDate,
      totalWeeks: weeklyTrend.length,
      filter,
      summary: {
        totalNewChange,
        totalClosed,
        totalOverdue,
        totalRisk,
        totalEstimatedAmount,
        avgHandlingDurationDays: durationSampleCount > 0 ? Math.round((totalDurationDays / durationSampleCount) * 10) / 10 : 0,
        handlingCompletionRate: handlingTotal > 0 ? Math.round((handlingHandled / handlingTotal) * 1000) / 10 : 0,
        weekOverWeek,
      },
      weeklyTrend,
      latestWeek,
      topOverdueProjects,
      topRiskProfessionals,
      anomalyAlerts,
    };
  }

  private buildAnomalyAlerts(
    current: CockpitWeekTrendPoint,
    previous: CockpitWeekTrendPoint | undefined
  ): CockpitAnomalyAlert[] {
    const alerts: CockpitAnomalyAlert[] = [];

    if (!previous) return alerts;

    const calcChangePercent = (curr: number, prev: number): number => {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return Math.round(((curr - prev) / prev) * 1000) / 10;
    };

    const getSeverity = (changePercent: number): 'high' | 'medium' | 'low' => {
      const abs = Math.abs(changePercent);
      if (abs >= 100) return 'high';
      if (abs >= 50) return 'medium';
      return 'low';
    };

    const overdueChange = calcChangePercent(current.overdueReminderCount, previous.overdueReminderCount);
    if (overdueChange >= 50) {
      alerts.push({
        type: 'overdue_spike',
        severity: getSeverity(overdueChange),
        message: `超期提醒数环比增长${overdueChange}%`,
        currentValue: current.overdueReminderCount,
        previousValue: previous.overdueReminderCount,
        changePercent: overdueChange,
      });
    }

    const riskChange = calcChangePercent(current.riskAlertCount, previous.riskAlertCount);
    if (riskChange >= 100) {
      alerts.push({
        type: 'risk_spike',
        severity: getSeverity(riskChange),
        message: `风险预警数环比增长${riskChange}%`,
        currentValue: current.riskAlertCount,
        previousValue: previous.riskAlertCount,
        changePercent: riskChange,
      });
    }

    const closureChange = calcChangePercent(current.closedChangeCount, previous.closedChangeCount);
    if (closureChange <= -50) {
      alerts.push({
        type: 'closure_drop',
        severity: getSeverity(closureChange),
        message: `闭合数环比下降${Math.abs(closureChange)}%`,
        currentValue: current.closedChangeCount,
        previousValue: previous.closedChangeCount,
        changePercent: closureChange,
      });
    }

    const amountChange = calcChangePercent(current.totalEstimatedAmount, previous.totalEstimatedAmount);
    if (amountChange >= 100) {
      alerts.push({
        type: 'amount_spike',
        severity: getSeverity(amountChange),
        message: `变更金额环比增长${amountChange}%`,
        currentValue: current.totalEstimatedAmount,
        previousValue: previous.totalEstimatedAmount,
        changePercent: amountChange,
      });
    }

    return alerts;
  }

  private buildTrendPoint(summary: WeeklySummary, filter?: { projectId?: string; professional?: Professional }): CockpitWeekTrendPoint {
    const weekLabel = `${summary.weekStart.slice(5)}/${summary.weekEnd.slice(5)}`;

    const weekStart = dayjs(summary.weekStart);
    const weekEnd = dayjs(summary.weekEnd).endOf('day');
    const allChanges = dataStore.getAllChanges();
    const filteredChanges = allChanges.filter(c => {
      if (filter?.projectId && c.projectId !== filter.projectId) return false;
      if (filter?.professional && c.professional !== filter.professional) return false;
      return true;
    });

    let newChangeCount = 0;
    let closedChangeCount = 0;
    let totalEstimatedAmount = 0;

    for (const c of filteredChanges) {
      const reg = dayjs(c.registeredDate);
      if (reg.isAfter(weekStart.subtract(1, 'day')) && reg.isBefore(weekEnd.add(1, 'day'))) {
        newChangeCount++;
        totalEstimatedAmount += c.estimatedAmount || 0;
      }
      if (c.status === 'closed' && c.closedDate) {
        const cd = dayjs(c.closedDate);
        if (cd.isAfter(weekStart.subtract(1, 'day')) && cd.isBefore(weekEnd.add(1, 'day'))) {
          closedChangeCount++;
        }
      }
    }

    const overdueReminderCount = (summary.stageBreakdown || []).reduce((s: number, b) => s + (b.overdueCount || 0), 0);
    const riskAlertCount = summary.totalNewRiskAlerts ?? summary.totalRiskAlerts ?? 0;

    const byProjectMap = new Map<string, { key: string; label: string; newChangeCount: number; closedChangeCount: number; totalAmount: number }>();
    const byProfMap = new Map<string, { key: string; label: string; newChangeCount: number; closedChangeCount: number; totalAmount: number }>();
    const byStageMap = new Map<ReminderStage, { key: string; label: string; overdueCount: number; handlingCount: number }>(
      ['registered_to_supervisor', 'supervisor_to_design', 'design_to_close'].map(s => [s, {
        key: s,
        label: stageLabels[s as ReminderStage],
        overdueCount: 0,
        handlingCount: 0,
      }] as any)
    );

    if (!filter?.professional) {
      for (const p of dataStore.getAllProjects()) {
        if (filter?.projectId && p.id !== filter.projectId) continue;
        byProjectMap.set(p.id, { key: p.id, label: p.name, newChangeCount: 0, closedChangeCount: 0, totalAmount: 0 });
      }
      for (const c of filteredChanges) {
        const proj = byProjectMap.get(c.projectId);
        if (proj) {
          const reg = dayjs(c.registeredDate);
          if (reg.isAfter(weekStart.subtract(1, 'day')) && reg.isBefore(weekEnd.add(1, 'day'))) {
            proj.newChangeCount++;
            proj.totalAmount += c.estimatedAmount || 0;
          }
          if (c.status === 'closed' && c.closedDate) {
            const cd = dayjs(c.closedDate);
            if (cd.isAfter(weekStart.subtract(1, 'day')) && cd.isBefore(weekEnd.add(1, 'day'))) proj.closedChangeCount++;
          }
        }
      }
    }

    if (!filter?.projectId) {
      for (const [k, label] of Object.entries(professionalLabels)) {
        byProfMap.set(k, { key: k, label, newChangeCount: 0, closedChangeCount: 0, totalAmount: 0 });
      }
      for (const c of filteredChanges) {
        const prof = byProfMap.get(c.professional);
        if (prof) {
          const reg = dayjs(c.registeredDate);
          if (reg.isAfter(weekStart.subtract(1, 'day')) && reg.isBefore(weekEnd.add(1, 'day'))) {
            prof.newChangeCount++;
            prof.totalAmount += c.estimatedAmount || 0;
          }
          if (c.status === 'closed' && c.closedDate) {
            const cd = dayjs(c.closedDate);
            if (cd.isAfter(weekStart.subtract(1, 'day')) && cd.isBefore(weekEnd.add(1, 'day'))) prof.closedChangeCount++;
          }
        }
      }
    }

    for (const stage of (summary.stageBreakdown || [])) {
      const s = byStageMap.get(stage.stage as ReminderStage);
      if (s) {
        s.overdueCount += stage.overdueCount;
        s.handlingCount += stage.totalCount;
      }
    }

    return {
      weekStart: summary.weekStart,
      weekEnd: summary.weekEnd,
      weekLabel,
      newChangeCount,
      closedChangeCount,
      overdueReminderCount,
      riskAlertCount,
      totalEstimatedAmount,
      byProject: filter?.professional ? undefined : Array.from(byProjectMap.values()),
      byProfessional: filter?.projectId ? undefined : Array.from(byProfMap.values()),
      byStage: Array.from(byStageMap.values()),
    };
  }

  private buildLatestWeek(
    point: CockpitWeekTrendPoint | undefined,
    summary: WeeklySummary | undefined,
    filter?: { projectId?: string; professional?: Professional }
  ): CockpitOverview['latestWeek'] {
    const now = dayjs();
    const startDate = point?.weekStart || now.startOf('week').format('YYYY-MM-DD');
    const endDate = point?.weekEnd || now.endOf('week').format('YYYY-MM-DD');

    const stageKeys: ReminderStage[] = ['registered_to_supervisor', 'supervisor_to_design', 'design_to_close'];
    const byStage = stageKeys.map(s => {
      const found = point?.byStage?.find(x => x.key === s);
      return found || { key: s, label: stageLabels[s], overdueCount: 0, handlingCount: 0 };
    });

    const byProject = (point?.byProject || []).map(x => {
      const related = [
        ...Array.from((dataStore as any).statusReminders?.values?.() || []),
        ...Array.from((dataStore as any).riskAlerts?.values?.() || []),
      ].filter((r: any) => r.projectId === x.key);
      const overdue = related.filter((r: any) =>
        r.handlingStatus === 'overdue_unhandled' ||
        (r.handlingDeadline && dayjs().isAfter(dayjs(r.handlingDeadline)) && r.handlingStatus !== 'handled')
      ).length;
      const risk = related.filter((r: any) => r.reminderType === 'risk_alert' || r.type === 'risk_alert').length;
      return {
        key: x.key,
        label: x.label,
        newChangeCount: x.newChangeCount,
        closedChangeCount: x.closedChangeCount,
        overdueCount: overdue,
        riskCount: risk,
        totalAmount: x.totalAmount,
      };
    });

    const byProfessional = (point?.byProfessional || []).map(x => ({
      key: x.key,
      label: x.label,
      newChangeCount: x.newChangeCount,
      closedChangeCount: x.closedChangeCount,
      overdueCount: 0,
      totalAmount: x.totalAmount,
    }));

    return { startDate, endDate, byProject, byProfessional, byStage };
  }
}

export const cockpitService = new CockpitService();
