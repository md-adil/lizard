export enum Types {
    ADD = "@content/add",
    REMOVE = "@content/remove",
    ACTIVE = "@content/active",
}

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
    type: Types.ADD;
    payload: IContent;
}

export interface IContentRemoveAction {
    type: Types.REMOVE;
    payload: IContent | string;
}

export interface IContentActiveAction {
    type: Types.ACTIVE;
    payload: string;
}

export type IContentAction =
    | IContentAddAction
    | IContentRemoveAction
    | IContentActiveAction;
