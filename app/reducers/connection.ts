import { ADD, CREATE, IConnection, UPDATE } from "../actions/connection";

interface IState {
    isCreating: boolean;
    data: IConnection[];
}

interface IAction {
    type: string;
    payload: IConnection;
}

export default (state: IState = {isCreating: false, data: []}, action: IAction) => {
    switch (action.type) {
        case CREATE:
            return { ...state, isCreating: true };
        case ADD:
            return { ...state, data: state.data };
        case UPDATE:
        default:
            return state;
    }
};
