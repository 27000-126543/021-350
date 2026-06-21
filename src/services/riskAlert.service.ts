import dayjs from 'dayjs';
import { dataStore } from '../store/dataStore';
import {
  RiskAlert,
  ChangeNegotiation,
  ChangeCategory,
  Professional,
  RiskFactorItem,
  categoryLabels,
  professionalLabels,
} from '../types';

type RiskGroupKey = string;

export class RiskAlertService {
  async detectAndGenerateAlerts(): Promise<RiskAlert[]> {
    const rules = dataStore.getReminderRules();
    const allChanges = dataStore.getAllChanges();
    const alerts: RiskAlert[] = [];
    const existingAlertKeys = new Set(
      dataStore.getAllRiskAlerts().map(a => this.getAlertKey(a))
    );

    const groupedChanges = this.groupChangesByRiskFactor(allChanges);

    for (const [key, changes] of Object.entries(groupedChanges)) {
      const recentChanges = changes.filter(c => {
        const daysSinceRegistered = dayjs().diff(dayjs(c.registeredDate), 'day');
        return daysSinceRegistered <= rules.riskTimeWindowDays;
      });

      if (recentChanges.length < rules.riskThresholdCount) {
        continue;
      }

      if (existingAlertKeys.has(key)) {
        continue;
      }

      const { projectId, category, professional } = this.parseRiskKey(key);
      const project = dataStore.getProject(projectId);
      if (!project) continue;

      const riskLevel = recentChanges.length >= rules.highRiskThresholdCount ? 'high' : 'medium';
      const totalAmount = recentChanges.reduce((sum, c) => sum + c.estimatedAmount, 0);

      const riskItems: RiskFactorItem[] = recentChanges
        .sort((a, b) => dayjs(b.registeredDate).valueOf() - dayjs(a.registeredDate).valueOf())
        .map(c => ({
          changeId: c.id,
          changeCode: c.code,
          changeTitle: c.title,
          registeredDate: c.registeredDate,
          estimatedAmount: c.estimatedAmount,
        }));

      const alert: RiskAlert = {
        id: dataStore.generateId(),
        type: 'risk_alert',
        projectId,
        projectName: project.name,
        category: category as ChangeCategory,
        professional: professional as Professional,
        changeCount: recentChanges.length,
        timeWindowDays: rules.riskTimeWindowDays,
        totalEstimatedAmount: totalAmount,
        changes: riskItems,
        riskLevel,
        suggestion: this.generateSuggestion(category as ChangeCategory, professional as Professional, recentChanges.length, riskLevel),
        createdAt: dayjs().toISOString(),
      };

      dataStore.addRiskAlert(alert);
      alerts.push(alert);
    }

    return alerts;
  }

  private groupChangesByRiskFactor(changes: ChangeNegotiation[]): Record<RiskGroupKey, ChangeNegotiation[]> {
    const groups: Record<RiskGroupKey, ChangeNegotiation[]> = {};

    for (const change of changes) {
      if (change.category === 'other') continue;
      if (change.status === 'rejected') continue;

      const key = this.buildRiskKey(change.projectId, change.category, change.professional);
      if (!groups[key]) groups[key] = [];
      groups[key].push(change);
    }

    return groups;
  }

  private buildRiskKey(projectId: string, category: ChangeCategory, professional: Professional): RiskGroupKey {
    return `${projectId}::${category}::${professional}`;
  }

  private getAlertKey(alert: RiskAlert): RiskGroupKey {
    return `${alert.projectId}::${alert.category}::${alert.professional}`;
  }

  private parseRiskKey(key: RiskGroupKey): { projectId: string; category: string; professional: string } {
    const [projectId, category, professional] = key.split('::');
    return { projectId, category, professional };
  }

  private generateSuggestion(
    category: ChangeCategory,
    professional: Professional,
    count: number,
    riskLevel: 'high' | 'medium' | 'low'
  ): string {
    const categoryText = categoryLabels[category];
    const professionalText = professionalLabels[professional];

    const levelPrefix = riskLevel === 'high' ? '【高风险】' : '【中风险】';

    const suggestions: Record<ChangeCategory, string> = {
      design_omission: `近期${professionalText}专业出现${count}起设计遗漏类变更，建议项目部组织设计、施工、监理三方召开专题会，系统性梳理图纸问题，避免同类问题重复发生。`,
      site_condition: `近期${professionalText}专业出现${count}起现场条件变化类变更，建议项目部集中核对地质勘察资料与现场实际情况，评估对工期和造价的总体影响，完善相关签证资料。`,
      material_substitution: `近期${professionalText}专业出现${count}起材料替换类变更，建议项目部专题研究材料替换方案，重点关注成本增量、性能指标和供应周期，统一报审流程。`,
      other: '',
    };

    return levelPrefix + suggestions[category];
  }

  getAlertsByProject(projectId: string): RiskAlert[] {
    return dataStore.getRiskAlertsByProject(projectId);
  }

  getAllAlerts(): RiskAlert[] {
    return dataStore.getAllRiskAlerts();
  }

  formatAlertMessage(alert: RiskAlert): string {
    const categoryText = categoryLabels[alert.category];
    const professionalText = professionalLabels[alert.professional];
    const riskLevelText = alert.riskLevel === 'high' ? '高风险' : '中风险';

    let message = `【变更洽商风险提示】
风险等级：${riskLevelText}
项目名称：${alert.projectName}
专业类别：${professionalText}
变更类型：${categoryText}
时间窗口：近 ${alert.timeWindowDays} 天
变更数量：${alert.changeCount} 条
预计金额：¥${alert.totalEstimatedAmount.toLocaleString()}

涉及变更：
`;

    alert.changes.forEach((c, i) => {
      message += `  ${i + 1}. ${c.changeCode} - ${c.changeTitle}（${c.registeredDate}，¥${c.estimatedAmount.toLocaleString()}）\n`;
    });

    message += `\n建议措施：${alert.suggestion}`;

    return message;
  }

  formatAlertDigest(alerts: RiskAlert[]): string {
    if (alerts.length === 0) return '暂无风险提示。';

    const highRiskCount = alerts.filter(a => a.riskLevel === 'high').length;
    const mediumRiskCount = alerts.filter(a => a.riskLevel === 'medium').length;

    let message = `【变更洽商风险汇总】共 ${alerts.length} 条风险提示，其中高风险 ${highRiskCount} 条，中风险 ${mediumRiskCount} 条。\n\n`;

    alerts.forEach((alert, i) => {
      const categoryText = categoryLabels[alert.category];
      const professionalText = professionalLabels[alert.professional];
      const levelIcon = alert.riskLevel === 'high' ? '🔴' : '🟡';

      message += `${levelIcon} ${alert.projectName} - ${professionalText}/${categoryText}（${alert.changeCount}条）\n`;
    });

    message += '\n请各项目部高度重视，及时组织专题研究，防范成本失控和索赔风险。';

    return message;
  }
}

export const riskAlertService = new RiskAlertService();
