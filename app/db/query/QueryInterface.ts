export default interface IQuery {
    execute(query: string, bindings?: string[]): Promise<any>;
    fetch(query: string): Promise<any>;
    fetchAll(query: string): Promise<any>;
}
