import * as React from "react";
import TableComponent from "../components/Table";
import Table from "../db/Table";

interface IProps {
    fields: any[];
    records: any[];
}

class TableContainer extends React.Component<IProps> {
    public render() {
        return (
            <TableComponent
                fields={this.props.fields}
                records={this.props.records}
            />
        );
    }
}

export default TableContainer;
