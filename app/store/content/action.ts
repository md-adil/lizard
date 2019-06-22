import * as React from "react";
import { ADD, REMOVE } from "./types";

export const add = (payload: React.ReactNode) => ({
    type: ADD,
    payload
});

export const remove = (payload: React.ReactNode) => ({
    type: REMOVE,
    payload
});
