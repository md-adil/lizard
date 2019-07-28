export const ADD = "@content/add";
export const REMOVE = "@content/remove";
export const ACTIVE = "@content/active";

export interface IContent {
    title: string;
    key?: string;
    closable?: boolean;
    content: React.ReactElement;
}

export interface IContentState {
    active?: string;
    closable?: boolean;
    data: IContent[];
}

export interface IContentAddAction {
    type: typeof ADD;
    payload: IContent;
}

export interface IContentRemoveAction {
    type: typeof REMOVE;
    payload: IContent | string;
}

export interface IContentActiveAction {
    type: typeof ACTIVE;
    payload: string;
}

export type IContentAction =
    | IContentAddAction
    | IContentRemoveAction
    | IContentActiveAction;
