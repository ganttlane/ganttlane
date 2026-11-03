/**
 * The task list page of the vanilla renderer (`/task-list/`, plan step 7.2): a chart and its list,
 * by hand or from `e2e/task-list.spec.ts`, whose hook is `window.__gantt`. The settings are in the
 * query string, see `task-list-plan.ts`.
 */
import '@ganttlane/dom/styles.css';
import './playground.css';

import { createGantt } from '@ganttlane/dom';
import { createTaskList } from '@ganttlane/dom/task-list';

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

const plan = document.createElement('div');
plan.className = 'plan';
plan.dataset.height = settings.height;
plan.style.setProperty('--plan-height', `${String(PLAN_HEIGHT)}px`);
const side = document.createElement('div');
const chart = document.createElement('div');
chart.className = 'plan__chart';
plan.append(side, chart);
document.querySelector('#app')?.append(plan);

const gantt = createGantt(chart, {
  ...planOptions,
  ...planChoices(settings),
  tasks: planTasks(settings.count),
  theme: settings.theme,
  layout: planLayout(settings.height),
});
if (settings.list) createTaskList(side, gantt, { columns: planColumns });

(window as unknown as { __gantt: unknown }).__gantt = gantt;
