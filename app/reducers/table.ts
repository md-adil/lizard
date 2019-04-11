import { ADD, DELETE, SET, CONNECT, ITableState, ITableSetAction, ITableAction } from "../actions/table";
import Table from "../db/Table";

const defaultState: ITableState = {
    data: []
};

export default (state = defaultState, action: ITableAction | ITableSetAction): ITableState => {
    if (action.type === ADD) {
        return { ...state, data: [...state.data, (action as ITableAction).payload] };
    }

    if (action.type === DELETE) {
        return {
            ...state,
            data: state.data.filter((t: Table) => t !== (action as ITableAction).payload)
        };
    }

    if (action.type === SET) {
        return { ...state, data: (action as ITableSetAction).paylaod };
    }

    if (action.type === CONNECT) {
        const a = action as ITableAction;
        return { ...state, data: state.data.map((table: Table) => {
            if (table === a.payload) {
                table.isConnected = true;
            }
            return table;
        }) };
    }

    return state;
};
