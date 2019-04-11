import * as React from "react";

interface IProps {
    fields: string[];
    data: any[];
}

interface IRowProps {
    row: any;
    fields: string[];
}
const Row = ({fields, row}: IRowProps) => (
    <tr>
        {fields.map((f: string) => <td key={f}>{(row[f] || '').toString()}</td>)}
    </tr>
);

export default (props: IProps) => (
    <table>
        {console.log('data: ', props.data)}
        <thead>
            <tr>
                {props.fields.map((f: string) => <th key={f}>{f}</th> )}
            </tr>
        </thead>
        <tbody>
            {props.data.map((r: any, i: number) => <Row key={i} fields={props.fields} row={r} />)}
        </tbody>
    </table>
);
