import express from 'express';
import cors from 'cors';
import projectsRouter from './routes/projects.route';
import changesRouter from './routes/changes.route';
import remindersRouter from './routes/reminders.route';
import { dataStore } from './store/dataStore';
import { seedDemoData } from './data/seedData';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'change-negotiation-reminder-service',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api', (req, res) => {
  res.json({
    name: '变更洽商智能提醒服务 API',
    version: '1.0.0',
    description: '面向大型施工企业的项目管理平台、合同系统或资料系统调用的智能提醒服务',
    endpoints: {
      projects: '/api/projects',
      changes: '/api/changes',
      reminders: '/api/reminders',
    },
    capabilities: [
      '状态提醒：超期未取得监理或设计意见时推送待办',
      '风险提示：同专业同类变更集中出现时生成风险预警',
      '统计推送：每周自动汇总形成管理简报',
    ],
  });
});

app.post('/api/seed', (req, res) => {
  const { projects, changes } = seedDemoData();
  res.json({
    code: 0,
    message: '示例数据初始化成功',
    data: {
      projects: projects.length,
      changes: changes.length,
    },
  });
});

app.use('/api/projects', projectsRouter);
app.use('/api/changes', changesRouter);
app.use('/api/reminders', remindersRouter);

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({
    code: 500,
    message: '服务器内部错误',
    error: err.message,
  });
});

app.use((req, res) => {
  res.status(404).json({
    code: 404,
    message: '接口不存在',
    path: req.path,
  });
});

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  变更洽商智能提醒服务`);
  console.log(`  服务端口: ${PORT}`);
  console.log(`  API 地址: http://localhost:${PORT}/api`);
  console.log(`  健康检查: http://localhost:${PORT}/health`);
  console.log(`========================================\n`);
});

export default app;
