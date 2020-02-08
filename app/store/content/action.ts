import { Types, IContent } from "./types";

export const add = (payload: IContent) => ({
    type: Types.ADD,
    payload
});

export const remove = (payload: string) => ({
    type: Types.REMOVE,
    payload
});

export const active = (payload: string) => ({
    type: Types.ACTIVE,
    payload
});
