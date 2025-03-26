import pool from "../db";
import { IUser, IUserCreate, IUserPublic } from "../interfaces/user.interface";

export class UserModel {
  static async create(userData: IUserCreate): Promise<IUser> {
    const { rows } = await pool.query<IUser>(
      `INSERT INTO users (name, email, password) 
       VALUES ($1, $2, $3) 
       RETURNING id, name, email, password, created_at as "createdAt", updated_at as "updatedAt"`,
      [userData.name, userData.email, userData.password]
    );
    return rows[0];
  }

  static async findByEmail(email: string): Promise<IUser | null> {
    const { rows } = await pool.query<IUser>(
      `SELECT id, name, email, password, created_at as "createdAt", updated_at as "updatedAt" 
       FROM users WHERE email = $1`,
      [email]
    );
    return rows[0] || null;
  }

  static async findById(id: number): Promise<IUserPublic | null> {
    const { rows } = await pool.query<IUserPublic>(
      `SELECT id, name, email FROM users WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  }
}
