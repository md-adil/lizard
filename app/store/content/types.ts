export const ADD = "@content/add";
export const REMOVE = "@content/remove";

export interface IContentState {
    active: string;
    data: React.ReactNode[];
}

export interface IContentAddAction {
    type: typeof ADD;
    payload: React.ReactNode;
}

export interface IContentRemoveAction {
    type: typeof REMOVE;
    payload: React.ReactNode;
}

export type IContentAction = IContentAddAction | IContentRemoveAction;
