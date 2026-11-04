/**
 * The task list page of React (`/react-task-list/`, plan step 7.2): `/task-list/` for `<TaskList>`,
 * with the same settings and the same hook (`window.__gantt`), in `<StrictMode>`, which does
 * something in the development builds (`/dev/react-task-list/`, `/react-18/react-task-list/`).
 */
import '@ganttlane/dom/styles.css';
import './playground.css';

import { type Task, TaskList, useGantt } from '@ganttlane/react';
import { type CSSProperties, type ReactElement, StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import {
  PLAN_HEIGHT,
  planChoices,
  planColumns,
  planLayout,
  planOptions,
  planSettings,
  planTasks,
} from './task-list-plan';

const settings = planSettings(location.search);
const tasks: Task[] = planTasks(settings.count);
const { viewMode, ...options } = planOptions;

function Plan(): ReactElement {
  const gantt = useGantt({
    ...options,
    ...planChoices(settings),
    defaultViewMode: viewMode,
    defaultTasks: tasks,
    theme: settings.theme,
    layout: planLayout(settings.height),
  });
  const { setContainer, slots } = gantt;
  useEffect(() => {
    (window as unknown as { __gantt: unknown }).__gantt = gantt;
  }, [gantt]);
  return (
    <div
      className="plan"
      data-height={settings.height}
      style={{ '--plan-height': `${String(PLAN_HEIGHT)}px` } as CSSProperties}
    >
      {settings.list ? (
        <TaskList gantt={gantt} columns={planColumns} cellNavigation={settings.cells} />
      ) : (
        <div />
      )}
      <div ref={setContainer} className="plan__chart" />
      {slots}
    </div>
  );
}

const app = document.querySelector('#app');
if (app) {
  createRoot(app).render(
    <StrictMode>
      <Plan />
    </StrictMode>,
  );
}
