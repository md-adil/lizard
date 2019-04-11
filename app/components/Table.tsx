import * as React  from "react";

interface IRowProps {
    children: React.ReactNode;
}
export const Row = (props: IRowProps) => (
    <div>{props.children}</div>
);

interface IColProps {
    children: React.ReactChildren;
}
export const Col = (props: IColProps) => (
    <div>hello world {props.children}</div>
)