import * as React from "react";
import TableComponent from "../components/Table";
import Table from "../db/Table";
import Field from "../db/Field";

interface IProps {
    fields: any[];
    records: any[];
    table: Table;
}

class TableContainer extends React.Component<IProps> {
    public handleChange = async (field: Field, record: any, value: any) => {
        const conditions = field.primaryKeys.reduce((c: any, v: any) => {
            c[v] = record[v];
            return c;
        }, {});
        await this.props.table.update(conditions, { [field.name]: value });
    };

    public render() {
        return (
            <TableComponent
                onChange={this.handleChange}
                fields={this.props.fields}
                records={this.props.records}
            />
        );
    }
}

export default TableContainer;
