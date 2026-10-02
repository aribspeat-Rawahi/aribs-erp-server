import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from './employee.entity';
import { AttendanceRecord } from './attendance.entity';
import { Role } from './role.entity';
import { Team } from './team.entity';
import { Department } from './department.entity';
import { Designation } from './designation.entity';
import { Shift } from './shift.entity';
import { Project } from './project.entity';
import { LeaveRequest } from './leave-request.entity';
import { PayrollRecord } from './payroll.entity';
import { HrEvent } from './event.entity';
import { Notice } from './notice.entity';
import { Holiday } from './holiday.entity';
import { EmployeeDocument } from './employee-document.entity';
import { PayrollDocument } from './payroll-document.entity';
import { SalaryAdvanceRequest } from './salary-advance.entity';
import { EmployeeService } from './employee.service';
import { AttendanceService } from './attendance.service';
import { RoleService } from './role.service';
import { TeamService } from './team.service';
import { DepartmentService } from './department.service';
import { DesignationService } from './designation.service';
import { ShiftService } from './shift.service';
import { ProjectService } from './project.service';
import { LeaveRequestService } from './leave-request.service';
import { PayrollService } from './payroll.service';
import { EventService } from './event.service';
import { NoticeService } from './notice.service';
import { HolidayService } from './holiday.service';
import { EmployeeDocumentService } from './employee-document.service';
import { PayrollDocumentService } from './payroll-document.service';
import { SalaryAdvanceService } from './salary-advance.service';
import { EmployeeController } from './employee.controller';
import { AttendanceController } from './attendance.controller';
import { RoleController } from './role.controller';
import { TeamController } from './team.controller';
import { DepartmentController } from './department.controller';
import { DesignationController } from './designation.controller';
import { ShiftController } from './shift.controller';
import { ProjectController } from './project.controller';
import { LeaveRequestController } from './leave-request.controller';
import { PayrollController } from './payroll.controller';
import { EventController } from './event.controller';
import { NoticeController } from './notice.controller';
import { HolidayController } from './holiday.controller';
import { EmployeeDocumentController } from './employee-document.controller';
import { PayrollDocumentController } from './payroll-document.controller';
import { SalaryAdvanceController } from './salary-advance.controller';
import { SettingsModule } from '../settings/settings.module';
import { JournalModule } from '../journal/journal.module';
import { BankAccountModule } from '../bank-account/bank-account.module';
import { ApprovalModule } from '../approval/approval.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Employee,
      AttendanceRecord,
      Role,
      Team,
      Department,
      Designation,
      Shift,
      Project,
      LeaveRequest,
      PayrollRecord,
      HrEvent,
      Notice,
      Holiday,
      EmployeeDocument,
      PayrollDocument,
      SalaryAdvanceRequest,
    ]),
    SettingsModule,
    JournalModule,
    BankAccountModule,
    // Only for SalaryAdvanceService — ApprovalModule depends purely on
    // TypeORM entities (no circular risk, see its own module comment).
    ApprovalModule,
  ],
  controllers: [
    EmployeeController,
    AttendanceController,
    RoleController,
    TeamController,
    DepartmentController,
    DesignationController,
    ShiftController,
    ProjectController,
    LeaveRequestController,
    PayrollController,
    EventController,
    NoticeController,
    HolidayController,
    EmployeeDocumentController,
    PayrollDocumentController,
    SalaryAdvanceController,
  ],
  providers: [
    EmployeeService,
    AttendanceService,
    RoleService,
    TeamService,
    DepartmentService,
    DesignationService,
    ShiftService,
    ProjectService,
    LeaveRequestService,
    PayrollService,
    EventService,
    NoticeService,
    HolidayService,
    EmployeeDocumentService,
    PayrollDocumentService,
    SalaryAdvanceService,
  ],
  exports: [
    EmployeeService,
    AttendanceService,
    RoleService,
    TeamService,
    DepartmentService,
    DesignationService,
    ShiftService,
    ProjectService,
    LeaveRequestService,
    PayrollService,
    EventService,
    NoticeService,
    HolidayService,
    EmployeeDocumentService,
    PayrollDocumentService,
    SalaryAdvanceService,
  ],
})
export class HrModule {}
