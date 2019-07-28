import * as React from "react";
import { ADD, REMOVE, ACTIVE, IContent } from "./types";

export const add = (payload: IContent) => ({
    type: ADD,
    payload
});

export const remove = (payload: string) => ({
    type: REMOVE,
    payload
});

export const active = (payload: string) => ({
    type: ACTIVE,
    payload
});
