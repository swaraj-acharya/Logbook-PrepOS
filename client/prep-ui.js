/*
 * The views added by Logbook PrepOS, gathered for client/ui.js:
 *   setup-ui.js  first run and the setup wizard
 *   study-ui.js  lectures, practice questions and question review
 *   plan-ui.js   today, the roadmap and plan, the weekly review, preparation settings and storage
 * Their actions, field handlers and dialogs are merged into ui.js's tables when the app mounts.
 */
import * as SETUP from './setup-ui.js';
import * as STUDY from './study-ui.js';
import * as PLAN from './plan-ui.js';

export { viewWelcome, viewWizard, startNewPreparation } from './setup-ui.js';
export { viewLectures, viewPractice, openLectureRecall, questionsDueCount, beginQuestionReview, openQuestion, recordQuestionResult, mistakeQuestionHTML,
  conceptQuestionsHTML, subjectQuestionsHTML, subjectLecturesHTML, resourcesHTML } from './study-ui.js';
export { viewDashboard, viewPlan, viewWeek, viewSubjectRoadmap, subjectDashboardHTML, storageBanner, settingsPrepHTML, settingsDataHTML, settingsMoreDataHTML, exportCopy, importFiles } from './plan-ui.js';

export const ACT = Object.assign({}, SETUP.ACT, STUDY.ACT, PLAN.ACT);
export const CHG = Object.assign({}, SETUP.CHG, STUDY.CHG, PLAN.CHG);
export const MODALS = Object.assign({}, STUDY.MODALS, PLAN.MODALS);
