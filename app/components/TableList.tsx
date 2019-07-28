import * as React from "react";
import Table from "../db/Table";

interface IRowProps {
    children: React.ReactNode;
}
export const Row = (props: IRowProps) => <div>{props.children}</div>;

interface IColProps {
    children: React.ReactChildren;
}
export const Col = (props: IColProps) => (
    <div>hello world {props.children}</div>
);

interface IProps {
    data: Table[];
    onSelect: (table: Table) => void;
}

export default (props: IProps) => (
    <div>
        {props.data.map((data: Table) => (
            <div onDoubleClick={() => props.onSelect(data)} key={data.name}>
                {data.name}
            </div>
        ))}
    </div>
);
