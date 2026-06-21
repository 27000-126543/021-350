import dayjs from 'dayjs';
import { dataStore } from '../store/dataStore';
import {
  WeeklySummary,
  ProjectWeeklyStats,
  ChangeNegotiation,
  categoryLabels,
} from '../types';
import { statusReminderService } from './statusReminder.service';

export class WeeklySummaryService {
  async generateWeeklySummary(): Promise<WeeklySummary> {
    const now = dayjs();
    const weekStart = now.startOf('week').add(1, 'day').format('YYYY-MM-DD');
    const weekEnd = now.endOf('week').add(1, 'day').format('YYYY-MM-DD');

    const projects = dataStore.getAllProjects();
    const allChanges = dataStore.getAllChanges();

    const projectStats: ProjectWeeklyStats[] = [];
    let totalNewChanges = 0;
    let totalClosedChanges = 0;
    let totalEstimatedAmount = 0;
    let totalOverdueCount = 0;
    let totalOutstanding = 0;

    for (const project of projects) {
      const projectChanges = allChanges.filter(c => c.projectId === project.id);
      const stats = this.calculateProjectStats(project, projectChanges, weekStart, weekEnd);
      projectStats.push(stats);

      totalNewChanges += stats.newCount;
      totalClosedChanges += stats.closedCount;
      totalEstimatedAmount += stats.totalEstimatedAmount;
      totalOverdueCount += stats.overdueCount;
      totalOutstanding += stats.totalOutstanding;
    }

    const overallClosureRate = totalNewChanges > 0
      ? Math.round((totalClosedChanges / (totalNewChanges + (totalOutstanding - totalClosedChanges))) * 100)
      : 0;

    const topRiskProjects = this.getTopRiskProjects(projectStats, 5);

    const summaryText = this.generateSummaryText(
      projects.length,
      totalNewChanges,
      totalClosedChanges,
      totalOutstanding,
      overallClosureRate,
      totalEstimatedAmount,
      totalOverdueCount,
      topRiskProjects
    );

    const summary: WeeklySummary = {
      id: dataStore.generateId(),
      type: 'weekly_summary',
      weekStart,
      weekEnd,
      generatedAt: now.toISOString(),
      totalProjects: projects.length,
      totalNewChanges,
      totalClosedChanges,
      overallClosureRate,
      totalEstimatedAmount,
      totalOverdueCount,
      projectStats,
      topRiskProjects: topRiskProjects.map(p => ({
        projectId: p.projectId,
        projectName: p.projectName,
        riskCount: p.overdueCount,
      })),
      summaryText,
    };

    dataStore.addWeeklySummary(summary);
    return summary;
  }

  private calculateProjectStats(
    project: { id: string; name: string },
    changes: ChangeNegotiation[],
    weekStart: string,
    weekEnd: string
  ): ProjectWeeklyStats {
    const weekStartDate = dayjs(weekStart);
    const weekEndDate = dayjs(weekEnd);

    const newCount = changes.filter(c => {
      const registered = dayjs(c.registeredDate);
      return registered.isAfter(weekStartDate) && registered.isBefore(weekEndDate);
    }).length;

    const closedCount = changes.filter(c => {
      if (!c.closedDate) return false;
      const closed = dayjs(c.closedDate);
      return closed.isAfter(weekStartDate) && closed.isBefore(weekEndDate);
    }).length;

    const totalOutstanding = changes.filter(c =>
      c.status !== 'closed' && c.status !== 'rejected'
    ).length;

    const totalChanges = changes.length;
    const closureRate = totalChanges > 0
      ? Math.round((changes.filter(c => c.status === 'closed').length / totalChanges) * 100)
      : 0;

    const totalEstimatedAmount = changes.reduce((sum, c) => sum + c.estimatedAmount, 0);

    const overdueChanges = statusReminderService.getOverdueChanges(project.id);
    const overdueCount = overdueChanges.length;

    const overdueItems = overdueChanges.slice(0, 5).map(c => ({
      changeId: c.id,
      changeCode: c.code,
      changeTitle: c.title,
      overdueDays: this.calculateOverdueDays(c),
    }));

    return {
      projectId: project.id,
      projectName: project.name,
      newCount,
      closedCount,
      totalOutstanding,
      closureRate,
      totalEstimatedAmount,
      overdueCount,
      overdueItems,
    };
  }

  private calculateOverdueDays(change: ChangeNegotiation): number {
    const rules = dataStore.getReminderRules();
    const now = dayjs();
    const registeredDate = dayjs(change.registeredDate);

    let reviewDays: number;
    let baseDate: dayjs.Dayjs;

    switch (change.status) {
      case 'registered':
        reviewDays = rules.supervisorReviewDays;
        baseDate = registeredDate;
        break;
      case 'supervisor_review':
        reviewDays = rules.designReviewDays;
        baseDate = change.supervisorOpinionDate
          ? dayjs(change.supervisorOpinionDate)
          : registeredDate.add(rules.supervisorReviewDays, 'day');
        break;
      default:
        return 0;
    }

    const dueDate = baseDate.add(reviewDays, 'day');
    return Math.max(0, now.diff(dueDate, 'day'));
  }

  private getTopRiskProjects(stats: ProjectWeeklyStats[], topN: number): ProjectWeeklyStats[] {
    return [...stats]
      .sort((a, b) => b.overdueCount - a.overdueCount)
      .filter(s => s.overdueCount > 0)
      .slice(0, topN);
  }

  private generateSummaryText(
    totalProjects: number,
    newCount: number,
    closedCount: number,
    outstandingCount: number,
    closureRate: number,
    totalAmount: number,
    overdueCount: number,
    topRiskProjects: ProjectWeeklyStats[]
  ): string {
    let text = `【本周变更洽商管理简报】

一、总体情况
统计周期内，公司 ${totalProjects} 个在建项目共新增变更洽商 ${newCount} 条，闭合 ${closedCount} 条，当前未闭合 ${outstandingCount} 条，整体闭合率 ${closureRate}%。
涉及预计金额合计 ¥${totalAmount.toLocaleString()}。
其中超期待办 ${overdueCount} 条，需重点关注。

二、重点关注项目
`;

    if (topRiskProjects.length === 0) {
      text += '  本周无超期严重项目，各项目资料管理情况良好。\n';
    } else {
      topRiskProjects.forEach((p, i) => {
        text += `  ${i + 1}. ${p.projectName}：超期 ${p.overdueCount} 条，未闭合 ${p.totalOutstanding} 条\n`;
      });
    }

    text += `
三、管理建议
1. 请各项目负责人关注超期条目，尽快推进监理、设计意见签认；
2. 超期较多的项目请分析原因，制定专项整改计划；
3. 做好变更资料的过程积累，防范索赔证据不足风险。

——工程管理部
`;

    return text;
  }

  getLatestSummary(): WeeklySummary | undefined {
    return dataStore.getLatestWeeklySummary();
  }

  getAllSummaries(): WeeklySummary[] {
    return dataStore.getAllWeeklySummaries();
  }

  formatBriefingEmail(summary: WeeklySummary): string {
    return summary.summaryText;
  }

  formatBriefingSMS(summary: WeeklySummary): string {
    return `【变更洽商周报】本周新增${summary.totalNewChanges}条，闭合${summary.totalClosedChanges}条，超期${summary.totalOverdueCount}条，整体闭合率${summary.overallClosureRate}%。详见管理系统。`;
  }
}

export const weeklySummaryService = new WeeklySummaryService();
