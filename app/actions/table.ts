import Table from "../db/Table";

export const ADD = "ADD TABLE";
export const DELETE = "DELETE TABLE";
export const SET = "SET TABLES";
export const CONNECT = "CONNECT TABLE";

export interface ITableState {
    data: Table[];
}

export interface ITableAction {
    type: string;
    payload: Table;
}

export interface ITableSetAction {
    type: string;
    paylaod: Table[];
}

export const set = (tables: Table[]): ITableSetAction => {
    return  {
        type: SET,
        paylaod: tables
    };
};

export const add = (table: Table): ITableAction => {
    return {
        type: ADD, payload: table
    };
};

export const remove = (table: Table): ITableAction => {
    return {
        type: ADD, payload: table
    };
};

export const connect = (table: Table): ITableAction => {
    return {
        type: CONNECT, payload: table
    };
};
