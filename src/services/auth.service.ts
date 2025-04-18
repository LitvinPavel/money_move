import bcrypt from "bcryptjs";
import { UserModel } from "../models/user.model";
import { TokenService } from "./token.service";
import { IUserCreate, IUserPublic } from "../interfaces/user.interface";
import { ITokens } from "../interfaces/token.interface";

export class AuthService {
  static async register(
    userData: IUserCreate
  ): Promise<{ user: IUserPublic; tokens: ITokens }> {
    const existingUser = await UserModel.findByEmail(userData.email);
    if (existingUser) throw new Error("Email already exists");

    const hashedPassword = await bcrypt.hash(userData.password, 10);
    const user = await UserModel.create({
      ...userData,
      password: hashedPassword,
    });

    const tokens = TokenService.generateTokens({ userId: user.id });

    return {
      user: { id: user.id, name: user.name, email: user.email },
      tokens,
    };
  }

  static async login(
    email: string,
    password: string
  ): Promise<{ user: IUserPublic; tokens: ITokens }> {
    const user = await UserModel.findByEmail(email);
    if (!user) throw new Error("Invalid credentials");

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) throw new Error("Invalid credentials");

    const tokens = TokenService.generateTokens({ userId: user.id });

    return {
      user: { id: user.id, name: user.name, email: user.email },
      tokens,
    };
  }

  static async refresh(refreshToken: string): Promise<ITokens> {
    const { userId } = TokenService.verifyRefreshToken(refreshToken);
    return TokenService.generateTokens({ userId });
  }
}