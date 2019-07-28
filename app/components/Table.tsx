import * as React from "react";

interface IProps {
    records: any[];
    fields: any[];
}

export default (props: IProps) => (
    <div>
        <table>
            <thead>
                <tr>
                    {props.fields.map(f => (
                        <th key={f.Field}>{f.Field}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {props.records.map((record, index) => (
                    <tr key={index}>
                        {props.fields.map((f: any) => (
                            <td key={f.Field}>{record[f.Field]}</td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);
