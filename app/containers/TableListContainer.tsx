import * as React from "react";
import TableComponent from "../components/TableList";
import Database from "../db/Database";
import Table from "../db/Table";
import store from "../store";
import * as contentAction from "../store/content/action";
import TableContainer from "./TableContainer";

interface IProps {
    tables: any[];
    database: Database;
}

interface IState {
    records: any[];
    fields: any[];
}

class TableListContainer extends React.Component<IProps, IState> {
    public handleTableSelect = async (table: Table) => {
        const fields = await table.fields();
        const records = await table.records();
        console.log({ records });
    };

    public render() {
        return (
            <TableComponent
                data={this.props.tables}
                onSelect={this.handleTableSelect}
            />
        );
    }
}
export default TableListContainer;
