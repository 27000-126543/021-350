import { Router, Request, Response } from 'express';
import { dataStore } from '../store/dataStore';
import { Project } from '../types';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const projects = dataStore.getAllProjects();
  res.json({
    code: 0,
    message: 'success',
    data: projects,
  });
});

router.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const project = dataStore.getProject(id);
  if (!project) {
    res.status(404).json({
      code: 404,
      message: '项目不存在',
      data: null,
    });
    return;
  }
  res.json({
    code: 0,
    message: 'success',
    data: project,
  });
});

router.post('/', (req: Request, res: Response) => {
  const body = req.body as Partial<Project>;
  if (!body.name || !body.code || !body.projectManager) {
    res.status(400).json({
      code: 400,
      message: '缺少必要参数：name, code, projectManager',
      data: null,
    });
    return;
  }

  const project: Project = {
    id: dataStore.generateId(),
    name: body.name,
    code: body.code,
    projectManager: body.projectManager,
    projectManagerPhone: body.projectManagerPhone || '',
    constructionScale: body.constructionScale || '',
    startDate: body.startDate || '',
    endDate: body.endDate || '',
  };

  dataStore.addProject(project);
  res.status(201).json({
    code: 0,
    message: '创建成功',
    data: project,
  });
});

export default router;
