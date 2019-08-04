import * as React from "react";
import Editable, { ChangeEvent } from "../ui/Editable";
import Field from "../db/Field";

interface IProps {
    records: any[];
    fields: Field[];
    onChange: (field: Field, record: any, value: any) => void;
}

interface IColProps {
    children: any;
    field: any;
    onChange: ChangeEvent;
}

const Col = (props: IColProps) => (
    <td>
        <Editable onChange={props.onChange} type={props.field.Type}>
            {props.children}
        </Editable>
    </td>
);

export default (props: IProps) => (
    <div>
        <table>
            <thead>
                <tr>
                    {props.fields.map((f: Field) => (
                        <th key={f.name}>{f.name}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {props.records.map((record, index) => (
                    <tr key={index}>
                        {props.fields.map((f: Field) => (
                            <Col
                                onChange={props.onChange.bind(null, f, record)}
                                key={f.name}
                                field={f}
                            >
                                {record[f.name]}
                            </Col>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);
