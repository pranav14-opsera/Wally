export interface IAuthProvider {
  verify(token: string): Promise<boolean>;
}
