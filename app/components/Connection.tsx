import * as React from "react";
import Connection from "../db/Connection";
import Table from "../db/Table";
import Tab from "../ui/Tab";
import DatabaseListContainer from "../containers/DatabaseListContainer";
import Database from "../db/Database";
import * as _ from "lodash";
import RecordContainer from "../containers/RecordContainer";
import "./connection.scss";

export interface IProps {
    connection: Connection;
    tables: Table[];
    handleTabChagne: (key: string) => void;
    activeTab: string;
    onSelectTable: (t: Table, evt: React.MouseEvent<HTMLAnchorElement>) => void;
}
interface ITableProps {
    table: Table;
    onSelect: (evt: React.MouseEvent<HTMLAnchorElement>) => void;
}
const TableName = (props: ITableProps) => (
    <div>
        <a href="#" onClick={props.onSelect}>{props.table.name}</a>
    </div>
);

export default (props: IProps) => (
    <div style={{display: "flex"}}>
        <aside>
            <DatabaseListContainer connection={props.connection} />
        </aside>
        <main>
            <Tab onChange={props.handleTabChagne} active={props.activeTab}>
                {props.tables.length && <Tab.Pane title="Tables" key="tables">
                    {props.tables.map((t:Table) => <TableName onSelect={props.onSelectTable.bind(null, t)} key={t.name} table={t} />)}
                </Tab.Pane> }
                    {props.tables.map((table: Table) => table.isConnected && <Tab.Pane key={table.name} title={table.name}>
                        <RecordContainer table={table} />
                    </Tab.Pane>)}
            </Tab>
        </main>
    </div>
);
