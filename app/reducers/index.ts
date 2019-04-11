import { combineReducers } from "redux";
import connection from "./connection";
import table from "./table";

export default combineReducers({ connection, table });
