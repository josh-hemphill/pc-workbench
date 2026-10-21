import {z} from 'zod';
export const hardwareSurveySchema=z.object({
 status:z.enum(['uninspected','partial','complete']),
 configurationId:z.union([z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),z.literal('')]),
 evidence:z.string().max(10000),
}).strict();
export type HardwareSurvey=z.infer<typeof hardwareSurveySchema>;
export const surveyChoices=[{title:'Not inspected',value:'uninspected'},{title:'Partially recorded',value:'partial'},{title:'Fully recorded',value:'complete'}];

export const hardwareSurveyLabel=(survey?:HardwareSurvey)=>surveyChoices.find(choice=>choice.value===survey?.status)?.title||'Not recorded';
