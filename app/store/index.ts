import { createStore, applyMiddleware, combineReducers } from "redux";
import thunk from "redux-thunk";
import content from "./content/reducer";
import connection from "./connection/reducer";

const rootReducers = combineReducers({ content, connection });

export type AppState = ReturnType<typeof rootReducers>;

export default createStore(
    rootReducers,
    applyMiddleware(thunk)
);
